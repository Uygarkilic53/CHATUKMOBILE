import type { Response } from 'express';
import mongoose from 'mongoose';
import sodium from 'libsodium-wrappers';
import type { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import Device from '../models/Device.js';
import Conversation from '../models/Conversation.js';
import { Backup } from '../models/Backup.js';

const BOXKEY_BINDING_PREFIX = 'e2ee-v1-boxkey|';

/**
 * Registers a new device for the authenticated user.
 * Validates the Ed25519 proof-of-possession signature and revokes any existing active device (v1 policy).
 */
export const registerDevice = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { deviceId, signPublicKey, boxPublicKey, boxKeySignature } = req.body;
    if (!deviceId || !signPublicKey || !boxPublicKey || !boxKeySignature) {
      res.status(400).json({ error: 'Missing required device key parameters' });
      return;
    }

    // Verify boxKeySignature using libsodium
    await sodium.ready;
    const bindingData = sodium.from_string(`${BOXKEY_BINDING_PREFIX}${deviceId}|${boxPublicKey}`);
    let isSigValid = false;
    try {
      const sigBytes = sodium.from_base64(boxKeySignature, sodium.base64_variants.ORIGINAL);
      const signPkBytes = sodium.from_base64(signPublicKey, sodium.base64_variants.ORIGINAL);
      isSigValid = sodium.crypto_sign_verify_detached(sigBytes, bindingData, signPkBytes);
    } catch {
      res.status(400).json({ error: 'Invalid key encoding in registration' });
      return;
    }

    if (!isSigValid) {
      res.status(400).json({ error: 'Signature verification failed: boxKeySignature does not bind keys' });
      return;
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);
    const now = new Date();

    // Support multi-device encryption (up to 10 active devices per user; if more than 10, revoke the oldest)
    const MAX_ACTIVE_DEVICES = 10;
    const activeDevices = await Device.find({
      userId: userObjectId,
      deviceId: { $ne: deviceId },
      revokedAt: { $exists: false },
    }).sort({ registeredAt: 1 }); // oldest first

    if (activeDevices.length >= MAX_ACTIVE_DEVICES) {
      const toRevokeCount = activeDevices.length - (MAX_ACTIVE_DEVICES - 1);
      const toRevokeIds = activeDevices.slice(0, toRevokeCount).map((d) => d._id);
      await Device.updateMany(
        { _id: { $in: toRevokeIds } },
        { $set: { revokedAt: now } }
      );
    }

    // If this physical device was previously claimed by another user, revoke it for them
    await Device.updateMany(
      { userId: { $ne: userObjectId }, deviceId, revokedAt: { $exists: false } },
      { $set: { revokedAt: now } }
    );

    // Register or reactivate device (upsert to prevent duplicate key E11000 error)
    const device = await Device.findOneAndUpdate(
      { userId: userObjectId, deviceId },
      {
        $set: {
          signPublicKey,
          boxPublicKey,
          boxKeySignature,
          registeredAt: now,
        },
        $unset: { revokedAt: 1 },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );

    res.status(200).json({
      success: true,
      device: {
        id: device._id,
        deviceId: device.deviceId,
        signPublicKey: device.signPublicKey,
        boxPublicKey: device.boxPublicKey,
        registeredAt: device.registeredAt,
      },
    });
  } catch (err: any) {
    console.error('[E2EE] Device registration error:', err);
    res.status(500).json({ error: 'Failed to register device' });
  }
};

/**
 * Fetches active public keys for a specific user's device.
 */
export const getUserActiveDevices = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const callerId = req.user?.id;
    if (!callerId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const paramUserId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
    if (!paramUserId || !mongoose.Types.ObjectId.isValid(paramUserId)) {
      res.status(400).json({ error: 'Invalid user ID' });
      return;
    }

    const targetObjectId = new mongoose.Types.ObjectId(paramUserId);

    // Authorization: caller must share a conversation with the target or be querying themselves
    if (callerId !== paramUserId) {
      const callerObjectId = new mongoose.Types.ObjectId(callerId);
      const sharedConv = await Conversation.findOne({
        $and: [
          { participants: { $in: [callerObjectId, callerId] } },
          { participants: { $in: [targetObjectId, paramUserId] } },
        ],
      });
      if (!sharedConv) {
        res.status(403).json({ error: 'Forbidden: No shared conversation with target user' });
        return;
      }
    }

    const devices = await Device.find({
      userId: targetObjectId,
    })
      .sort({ registeredAt: -1 })
      .select('deviceId signPublicKey boxPublicKey boxKeySignature registeredAt revokedAt');

    res.json({
      userId: paramUserId,
      devices: devices.map((d) => ({
        deviceId: d.deviceId,
        signPublicKey: d.signPublicKey,
        boxPublicKey: d.boxPublicKey,
        boxKeySignature: d.boxKeySignature,
        registeredAt: d.registeredAt,
        isActive: !d.revokedAt,
      })),
    });
  } catch (err: any) {
    console.error('[E2EE] Fetch devices error:', err);
    res.status(500).json({ error: 'Failed to fetch user devices' });
  }
};

/**
 * Returns the exact set of active devices for all participants in a conversation plus the caller's own device.
 * Used by the client to construct the exact recipient envelopes required for the next send.
 */
export const getConversationRecipients = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const callerId = req.user?.id;
    if (!callerId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const idParam = req.params.id;
    const conversationId = Array.isArray(idParam) ? idParam[0] : idParam;
    if (!conversationId || !mongoose.Types.ObjectId.isValid(conversationId)) {
      res.status(400).json({ error: 'Invalid conversation ID' });
      return;
    }

    const callerObjectId = new mongoose.Types.ObjectId(callerId);
    const conversation = await Conversation.findOne({
      _id: new mongoose.Types.ObjectId(conversationId),
      participants: { $in: [callerObjectId, callerId] },
    });

    if (!conversation) {
      res.status(403).json({ error: 'Not a participant of this conversation' });
      return;
    }

    // Fetch active devices for all participants in the conversation
    const participantObjectIds = conversation.participants.map((p: any) =>
      mongoose.Types.ObjectId.isValid(p) ? new mongoose.Types.ObjectId(p) : p
    );
    const devices = await Device.find({
      userId: { $in: participantObjectIds },
      revokedAt: { $exists: false },
    }).select('userId deviceId boxPublicKey signPublicKey');

    // Deduplicate devices by deviceId so each physical device appears at most once
    const seenDeviceIds = new Set<string>();
    const uniqueRecipients: any[] = [];
    for (const d of devices) {
      if (!seenDeviceIds.has(d.deviceId)) {
        seenDeviceIds.add(d.deviceId);
        uniqueRecipients.push({
          userId: d.userId.toString(),
          deviceId: d.deviceId,
          boxPublicKey: d.boxPublicKey,
          signPublicKey: d.signPublicKey,
        });
      }
    }

    res.json({
      conversationId,
      recipients: uniqueRecipients,
    });
  } catch (err: any) {
    console.error('[E2EE] Fetch conversation recipients error:', err);
    res.status(500).json({ error: 'Failed to fetch recipients' });
  }
};

/**
 * Uploads or updates an encrypted, zero-knowledge backup blob for the authenticated user.
 */
export const uploadBackup = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { version, salt, nonce, ciphertext, exportedAt } = req.body;
    if (!salt || !nonce || !ciphertext) {
      res.status(400).json({ error: 'Missing required backup parameters' });
      return;
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);

    const backup = await Backup.findOneAndUpdate(
      { userId: userObjectId },
      {
        userId: userObjectId,
        version: version || 1,
        salt,
        nonce,
        ciphertext,
        exportedAt: exportedAt || Date.now(),
      },
      { upsert: true, returnDocument: 'after' }
    );

    res.json({
      success: true,
      backup: {
        version: backup.version,
        exportedAt: backup.exportedAt,
        updatedAt: backup.updatedAt,
      },
    });
  } catch (err: any) {
    console.error('[E2EE] Upload backup error:', err);
    res.status(500).json({ error: 'Failed to upload encrypted backup' });
  }
};

/**
 * Retrieves the user's encrypted backup blob.
 */
export const getBackup = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const backup = await Backup.findOne({
      userId: new mongoose.Types.ObjectId(userId),
    });

    if (!backup) {
      res.status(404).json({ error: 'No encrypted backup found' });
      return;
    }

    res.json({
      version: backup.version,
      salt: backup.salt,
      nonce: backup.nonce,
      ciphertext: backup.ciphertext,
      exportedAt: backup.exportedAt,
      createdAt: backup.createdAt,
      updatedAt: backup.updatedAt,
    });
  } catch (err: any) {
    console.error('[E2EE] Get backup error:', err);
    res.status(500).json({ error: 'Failed to retrieve backup' });
  }
};

/**
 * Deletes the user's encrypted backup.
 */
export const deleteBackup = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    await Backup.deleteOne({
      userId: new mongoose.Types.ObjectId(userId),
    });

    res.json({ success: true, message: 'Encrypted backup removed' });
  } catch (err: any) {
    console.error('[E2EE] Delete backup error:', err);
    res.status(500).json({ error: 'Failed to delete backup' });
  }
};

