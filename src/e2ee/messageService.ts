/**
 * E2EE message service coordinating encryption, envelope wrapping, sending,
 * receipt processing, and local database caching.
 * Follows E2EE_IMPLEMENTATION_SPEC.md Section 3.3, 3.4, and Section 6.1.
 */
import { Platform } from 'react-native';
import { defaultCipher } from '../crypto/sodiumCipher';
import { PlainPayload, RecipientDevice, PayloadKind } from '../crypto/E2EECipher';
import {
  getOrGenerateDeviceKeys,
  isDeviceRegisteredOnBackend,
  setDeviceRegisteredOnBackend,
  resetDeviceRegistrationState,
} from './keyStore';
import {
  saveLocalMessage,
  getConversationMessages,
  deleteLocalMessagesBatch,
  purgeNonPendingLocalMessages,
  updateLocalMessageReactions,
  updateLocalMessageDeliveryStatus,
  StoredMessage,
} from './localDb';
import { verifyAndPinContactKey } from './keyDirectory';
import { getOrigin } from '../lib/auth-client';
import { api, getActiveUserId } from '../lib/api';
import { socketService } from '../services/socket';

export interface SendMessageOptions {
  conversationId: string;
  senderId: string;
  type?: 'text' | 'image' | 'video' | 'audio' | 'reaction' | 'control' | 'system';
  payload: PlainPayload;
  fileUrl?: string;
  clientMessageId?: string;
}

export function resetDeviceRegistrationCache(): void {
  resetDeviceRegistrationState();
}

export { resetDeviceRegistrationState };

/**
 * Registers this device's public keys on the backend if not already registered.
 * Pass force = true to bypass in-memory registration cache.
 */
export async function registerCurrentDevice(force = false): Promise<void> {
  if (isDeviceRegisteredOnBackend() && !force) {
    return;
  }

  const authHeaders = await api.getAuthHeaders();
  if (!authHeaders['Authorization'] && Platform.OS === 'web') {
    // Session token not yet resolved in browser storage; skip unauthenticated attempt
    return;
  }

  const keys = await getOrGenerateDeviceKeys();
  const serverUrl = getOrigin();

  try {
    const response = await fetch(`${serverUrl}/api/e2ee/devices`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify({
        deviceId: keys.deviceId,
        signPublicKey: keys.signPublicKey,
        boxPublicKey: keys.boxPublicKey,
        boxKeySignature: keys.boxKeySignature,
      }),
    });

    if (response.status === 401) {
      // User is not authenticated yet; will register once signed in
      return;
    }

    if (response.ok || response.status === 409) {
      setDeviceRegisteredOnBackend(true);
    } else {
      console.warn('[E2EE] Device registration status:', response.status);
    }
  } catch (err) {
    console.warn('[E2EE] Device registration connection error:', err);
  }
}

/**
 * Fetches active recipient devices for a conversation from the backend.
 */
export async function fetchConversationRecipients(
  conversationId: string
): Promise<RecipientDevice[]> {
  const serverUrl = getOrigin();
  const authHeaders = await api.getAuthHeaders();

  const response = await fetch(`${serverUrl}/api/e2ee/conversations/${conversationId}/recipients`, {
    credentials: 'include',
    headers: {
      ...authHeaders,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch conversation recipients: ${response.status}`);
  }

  const data = await response.json();
  return (data.recipients || []).map((r: any) => ({
    userId: r.userId,
    deviceId: r.deviceId,
    boxPublicKey: r.boxPublicKey,
    signPublicKey: r.signPublicKey,
  }));
}

/**
 * Fetches a contact's active device public keys.
 */
export async function fetchUserActiveDevices(userId: string): Promise<any[]> {
  const serverUrl = getOrigin();
  const authHeaders = await api.getAuthHeaders();

  const response = await fetch(`${serverUrl}/api/e2ee/users/${userId}/devices`, {
    credentials: 'include',
    headers: {
      ...authHeaders,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch active devices for user ${userId}: ${response.status}`);
  }

  const data = await response.json();
  return data.devices || [];
}

/**
 * Encrypts and sends a message, writing it optimistically to the local database.
 */
export async function sendEncryptedMessage(options: SendMessageOptions): Promise<{
  clientMessageId: string;
  encryptedPackage: any;
}> {
  const ownKeys = await getOrGenerateDeviceKeys();
  const { conversationId, senderId, type = 'text', payload, fileUrl } = options;

  // 1. Generate unique clientMessageId or use provided optimistic ID
  const resolvedClientMessageId = options.clientMessageId || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  // 2. Fetch active recipients for this conversation
  let recipients = await fetchConversationRecipients(conversationId);

  // If sender's own device is not among active recipients on the server, force register it now
  if (!recipients.some((r) => r.deviceId === ownKeys.deviceId)) {
    try {
      await registerCurrentDevice(true);
      recipients = await fetchConversationRecipients(conversationId);
    } catch (regErr) {
      console.warn('[E2EE] Pre-send device registration error:', regErr);
    }
  }

  // Ensure sender's own device is always in the recipient list so the sender can decrypt their own sent messages
  const effectiveSenderId = (senderId && senderId !== 'me') ? senderId : (await getActiveUserId()) || senderId;
  if (!recipients.some((r) => r.deviceId === ownKeys.deviceId)) {
    recipients.push({
      userId: effectiveSenderId,
      deviceId: ownKeys.deviceId,
      boxPublicKey: ownKeys.boxPublicKey,
      signPublicKey: ownKeys.signPublicKey,
    });
  }

  // Pin / verify each recipient's sign key (TOFU)
  for (const r of recipients) {
    if (r.userId !== senderId && (r as any).signPublicKey) {
      const check = await verifyAndPinContactKey({
        userId: r.userId,
        deviceId: r.deviceId,
        signPublicKey: (r as any).signPublicKey,
        boxPublicKey: r.boxPublicKey,
      });

      if (check.status === 'KEY_CHANGED') {
        await saveLocalMessage({
          clientMessageId: `sys_key_changed_${r.userId}_${Date.now()}`,
          conversationId,
          senderId: 'system',
          senderDeviceId: 'system',
          type: 'system',
          payload: {
            kind: 'text',
            body: `Security code with contact has changed. Tap to verify.`,
            sentAt: Date.now(),
          },
          isOutgoing: false,
          deliveryStatus: 'delivered',
        });
      }
    }
  }

  // Deduplicate recipients by deviceId so each device receives at most one envelope
  const seenDeviceMap = new Map<string, RecipientDevice>();
  for (const r of recipients) {
    if (!seenDeviceMap.has(r.deviceId)) {
      seenDeviceMap.set(r.deviceId, r);
    }
  }
  const uniqueRecipients = Array.from(seenDeviceMap.values());

  // 3. Encrypt payload for all recipient devices (including sender's own device)
  const encryptedPackage = await defaultCipher.encryptMessage({
    plaintextPayload: payload,
    conversationId,
    clientMessageId: resolvedClientMessageId,
    senderId,
    senderDeviceId: ownKeys.deviceId,
    type,
    recipientDevices: uniqueRecipients,
    signSecretKey: ownKeys.signSecretKey,
    boxSecretKey: ownKeys.boxSecretKey,
  });

  // 4. Save optimistic plaintext record in local database
  await saveLocalMessage({
    clientMessageId: resolvedClientMessageId,
    conversationId,
    senderId,
    senderDeviceId: ownKeys.deviceId,
    type,
    payload,
    isOutgoing: true,
    deliveryStatus: 'pending',
  });

  // 5. Send to server via real-time WebSocket if connected, else fallback to HTTP
  const socketPayload = {
    conversationId,
    clientMessageId: resolvedClientMessageId,
    type,
    encrypted: encryptedPackage.encrypted,
    fileUrl,
    envelopes: encryptedPackage.envelopes,
  };

  if (socketService.isSocketConnected()) {
    socketService.sendEncryptedPayload(socketPayload);
    return {
      clientMessageId: resolvedClientMessageId,
      encryptedPackage,
    };
  }

  const serverUrl = getOrigin();
  const authHeaders = await api.getAuthHeaders();

  try {
    const sendResponse = await fetch(`${serverUrl}/api/messages/conversations/${conversationId}/messages`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify({
        clientMessageId: resolvedClientMessageId,
        type,
        encrypted: encryptedPackage.encrypted,
        fileUrl,
        envelopes: encryptedPackage.envelopes,
      }),
    });

    // Handle 409 stale recipient set: refetch recipients and retry once
    if (sendResponse.status === 409) {
      console.warn('[E2EE] 409 Stale recipient set encountered. Refetching and retrying...');
      const freshRecipients = await fetchConversationRecipients(conversationId);
      if (!freshRecipients.some((r) => r.deviceId === ownKeys.deviceId)) {
        freshRecipients.push({
          userId: senderId,
          deviceId: ownKeys.deviceId,
          boxPublicKey: ownKeys.boxPublicKey,
          signPublicKey: ownKeys.signPublicKey,
        });
      }

      const freshPackage = await defaultCipher.encryptMessage({
        plaintextPayload: payload,
        conversationId,
        clientMessageId: resolvedClientMessageId,
        senderId,
        senderDeviceId: ownKeys.deviceId,
        type,
        recipientDevices: freshRecipients,
        signSecretKey: ownKeys.signSecretKey,
        boxSecretKey: ownKeys.boxSecretKey,
      });

      const retryResponse = await fetch(`${serverUrl}/api/messages/conversations/${conversationId}/messages`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({
          clientMessageId: resolvedClientMessageId,
          type,
          encrypted: freshPackage.encrypted,
          fileUrl,
          envelopes: freshPackage.envelopes,
        }),
      });

      if (!retryResponse.ok) {
        const errData = await retryResponse.json().catch(() => null);
        throw new Error(errData?.error || `Failed to send message on retry: ${retryResponse.status}`);
      }

      await updateLocalMessageDeliveryStatus(resolvedClientMessageId, 'sent', conversationId).catch(() => {});
      return { clientMessageId: resolvedClientMessageId, encryptedPackage: freshPackage };
    }

    if (!sendResponse.ok) {
      const errData = await sendResponse.json().catch(() => null);
      throw new Error(errData?.error || `Failed to send message: ${sendResponse.status}`);
    }

    await updateLocalMessageDeliveryStatus(resolvedClientMessageId, 'sent', conversationId).catch(() => {});
    return { clientMessageId: resolvedClientMessageId, encryptedPackage };
  } catch (err) {
    await updateLocalMessageDeliveryStatus(resolvedClientMessageId, 'failed', conversationId).catch(() => {});
    throw err;
  }
}

function resolveTimestamp(raw: any): number {
  if (typeof raw === 'number' && !isNaN(raw)) return raw;
  if (raw) {
    const t = new Date(raw).getTime();
    if (!isNaN(t)) return t;
  }
  return Date.now();
}

/**
 * Decrypts an incoming message and stores the readable result in the local database.
 */
export async function processIncomingMessage(data: {
  message: any;
  envelope?: { nonce: string; wrappedKey: string } | null;
}): Promise<PlainPayload | null> {
  const { message, envelope } = data;
  if (!message) return null;

  const ownKeys = await getOrGenerateDeviceKeys();
  const currentUserId = await getActiveUserId();

  const isOutgoing = currentUserId && message.senderId
    ? String(message.senderId) === String(currentUserId)
    : Boolean(message.encrypted?.senderDeviceId && message.encrypted.senderDeviceId === ownKeys.deviceId) ||
      Boolean((message as any).isOutgoing);

  const safeSentAt = resolveTimestamp(message.createdAt);

  // 1. Handle unencrypted system messages
  if (message.type === 'system') {
    const sysPayload: PlainPayload = {
      kind: 'text',
      body: message.content || '',
      sentAt: safeSentAt,
    };
    await saveLocalMessage({
      clientMessageId: message.clientMessageId || message._id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      senderDeviceId: 'system',
      type: 'system',
      payload: sysPayload,
      isOutgoing: false,
      deliveryStatus: 'delivered',
      createdAt: safeSentAt,
    });
    return sysPayload;
  }

  // 2. Handle unencrypted (legacy or plain) messages
  if (!message.encrypted) {
    const isImage = message.type === 'image';
    const isVideo = message.type === 'video';
    const isAudio = message.type === 'audio';
    const kind: PayloadKind = isImage ? 'image' : isVideo ? 'video' : isAudio ? 'audio' : 'text';

    const plainPayload: PlainPayload = {
      kind,
      body: message.content || '',
      attachment: message.fileUrl
        ? {
            url: message.fileUrl,
            mime: isImage ? 'image/jpeg' : isVideo ? 'video/mp4' : isAudio ? 'audio/m4a' : 'application/octet-stream',
            size: 0,
            key: '',
          }
        : undefined,
      sentAt: safeSentAt,
    };

    await saveLocalMessage({
      clientMessageId: message.clientMessageId || message._id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      senderDeviceId: 'legacy',
      type: message.type || 'text',
      payload: plainPayload,
      isOutgoing,
      deliveryStatus: 'delivered',
      createdAt: safeSentAt,
    });
    return plainPayload;
  }

  // 3. Handle encrypted message without envelope for this device
  if (message.encrypted && !envelope) {
    if (isOutgoing) {
      return {
        kind: (message.type as PayloadKind) || 'text',
        body: message.content && !message.content.startsWith('🔒 Encrypted message') ? message.content : '',
        sentAt: safeSentAt,
      };
    }
    console.warn('[E2EE] Message has ciphertext but no envelope for this device');
    const placeholderPayload: PlainPayload = {
      kind: 'text',
      body: message.content || '🔒 Encrypted message (key not available on this device)',
      sentAt: safeSentAt,
    };
    await saveLocalMessage({
      clientMessageId: message.clientMessageId || message._id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      senderDeviceId: message.encrypted.senderDeviceId || 'unknown',
      type: message.type || 'text',
      payload: placeholderPayload,
      isOutgoing,
      deliveryStatus: 'delivered',
      createdAt: safeSentAt,
    });
    return placeholderPayload;
  }

  // 4. Fetch or resolve sender device public keys
  let senderDevice: { deviceId: string; signPublicKey: string; boxPublicKey: string } | undefined;

  if (message.encrypted?.senderDeviceId && message.encrypted.senderDeviceId === ownKeys.deviceId) {
    senderDevice = {
      deviceId: ownKeys.deviceId,
      signPublicKey: ownKeys.signPublicKey,
      boxPublicKey: ownKeys.boxPublicKey,
    };
  } else {
    try {
      const senderDevices = await fetchUserActiveDevices(message.senderId);
      senderDevice = senderDevices.find((d: any) => d.deviceId === message.encrypted.senderDeviceId);
    } catch (devErr) {
      console.warn('[E2EE] Could not fetch sender active devices:', devErr);
    }
  }

  if (!senderDevice) {
    console.warn(`[E2EE] Sender active device key not found for user ${message.senderId}`);
    const placeholderPayload: PlainPayload = {
      kind: 'text',
      body: message.content || '🔒 Encrypted message (sender key unavailable)',
      sentAt: safeSentAt,
    };
    await saveLocalMessage({
      clientMessageId: message.clientMessageId || message._id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      senderDeviceId: message.encrypted?.senderDeviceId || 'unknown',
      type: message.type || 'text',
      payload: placeholderPayload,
      isOutgoing,
      deliveryStatus: 'delivered',
      createdAt: safeSentAt,
    });
    return placeholderPayload;
  }

  // Pin & verify sender key (TOFU) only for other contacts
  if (senderDevice.deviceId !== ownKeys.deviceId) {
    try {
      const keyCheck = await verifyAndPinContactKey({
        userId: message.senderId,
        deviceId: senderDevice.deviceId,
        signPublicKey: senderDevice.signPublicKey,
        boxPublicKey: senderDevice.boxPublicKey,
      });

      if (keyCheck.status === 'KEY_CHANGED') {
        await saveLocalMessage({
          clientMessageId: `sys_key_changed_${message.senderId}_${Date.now()}`,
          conversationId: message.conversationId,
          senderId: 'system',
          senderDeviceId: 'system',
          type: 'system',
          payload: {
            kind: 'text',
            body: `Security code with sender has changed. Tap to verify.`,
            sentAt: Date.now(),
          },
          isOutgoing: false,
          deliveryStatus: 'delivered',
        });
      }
    } catch (tofuErr) {
      console.warn('[E2EE] Key pinning verification warning:', tofuErr);
    }
  }

  // 5. Decrypt payload
  let plainPayload: PlainPayload;
  try {
    plainPayload = await defaultCipher.decryptMessage({
      conversationId: message.conversationId,
      clientMessageId: message.clientMessageId || message._id,
      senderId: message.senderId,
      type: message.type,
      encrypted: message.encrypted,
      envelope: {
        nonce: envelope!.nonce,
        wrappedKey: envelope!.wrappedKey,
      },
      senderSignPublicKey: senderDevice.signPublicKey,
      senderBoxPublicKey: senderDevice.boxPublicKey,
      recipientBoxSecretKey: ownKeys.boxSecretKey,
    });
  } catch (decryptErr) {
    console.warn('[E2EE] Failed to decrypt message content:', decryptErr);
    plainPayload = {
      kind: 'text',
      body: message.content || '🔒 Encrypted message (key not available on this device)',
      sentAt: safeSentAt,
    };
  }

  // 6. Save decrypted payload to local encrypted SQLite
  await saveLocalMessage({
    clientMessageId: message.clientMessageId || message._id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    senderDeviceId: message.encrypted?.senderDeviceId || 'unknown',
    type: message.type,
    payload: plainPayload,
    isOutgoing,
    deliveryStatus: 'delivered',
    reactions: message.reactions,
    createdAt: safeSentAt,
  });

  return plainPayload;
}

/**
 * Loads and decrypts historical messages for a conversation, caching them in local SQLite.
 */
export async function loadConversationMessages(
  conversationId: string,
  page = 1,
  limit = 50
): Promise<StoredMessage[]> {
  const ownKeys = await getOrGenerateDeviceKeys();
  const serverUrl = getOrigin();
  const authHeaders = await api.getAuthHeaders();

  const response = await fetch(
    `${serverUrl}/api/messages/conversations/${conversationId}/messages?page=${page}&limit=${limit}`,
    {
      credentials: 'include',
      headers: {
        'x-device-id': ownKeys.deviceId,
        ...authHeaders,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to load messages: ${response.status}`);
  }

  const data = await response.json();
  const remoteMessages = data.messages || [];

  const inMemoryDecrypted: StoredMessage[] = [];

  const effectiveUserId = data.currentUserId || (await getActiveUserId());

  // Process and decrypt remote messages
  for (const m of remoteMessages) {
    if (m.reactions && Array.isArray(m.reactions)) {
      if (m.clientMessageId) {
        updateLocalMessageReactions(conversationId, m.clientMessageId, m.reactions).catch(() => {});
      }
      if (m._id) {
        updateLocalMessageReactions(conversationId, m._id.toString(), m.reactions).catch(() => {});
      }
    }
    try {
      const payload = await processIncomingMessage({ message: m, envelope: m.envelope });
      if (payload) {
        const isOutgoing = effectiveUserId && m.senderId
          ? String(m.senderId) === String(effectiveUserId)
          : Boolean(m.encrypted?.senderDeviceId && m.encrypted.senderDeviceId === ownKeys.deviceId) ||
            Boolean((m as any).isOutgoing);
        inMemoryDecrypted.push({
          clientMessageId: m.clientMessageId || m._id,
          conversationId: m.conversationId,
          senderId: m.senderId,
          senderDeviceId: m.encrypted?.senderDeviceId || 'unknown',
          type: m.type || 'text',
          kind: payload.kind || 'text',
          body: payload.body || '',
          attachmentJson: payload.attachment ? JSON.stringify(payload.attachment) : undefined,
          reactionJson: m.reactions && m.reactions.length > 0
            ? JSON.stringify(m.reactions)
            : (payload.reaction ? JSON.stringify(payload.reaction) : undefined),
          replyToJson: payload.replyTo ? JSON.stringify(payload.replyTo) : undefined,
          sentAt: payload.sentAt || Date.now(),
          isOutgoing: isOutgoing ? 1 : 0,
          deliveryStatus: 'delivered',
          createdAt: resolveTimestamp(m.createdAt),
        });
      }
    } catch (decryptErr) {
      console.warn('[E2EE] Could not process historical message:', decryptErr);
    }
  }

  // Return full chronological list from local encrypted database, with in-memory fallback
  const stored = await getConversationMessages(conversationId, limit, (page - 1) * limit);

  // When refreshing or loading page 1, prune any messages that were deleted on the server
  let activeStored = stored;
  if (page === 1 && response.ok && stored && stored.length > 0) {
    if (remoteMessages.length === 0) {
      // All messages on the server for this conversation were deleted!
      // Purge all non-pending messages for conversationId in SQLite
      await purgeNonPendingLocalMessages(conversationId).catch(() => {});
      activeStored = stored.filter((sm) => sm.deliveryStatus === 'pending' || sm.deliveryStatus === 'failed');
    } else {
      const remoteClientIds = new Set(remoteMessages.map((m: any) => m.clientMessageId).filter(Boolean));
      const remoteMongoIds = new Set(remoteMessages.map((m: any) => m._id?.toString()).filter(Boolean));
      const oldestRemoteTime = Math.min(...remoteMessages.map((m: any) => resolveTimestamp(m.createdAt)));

      const toPrune: string[] = [];
      activeStored = stored.filter((sm) => {
        // Retain pending and failed outgoing messages that haven't reached server yet
        if (sm.deliveryStatus === 'pending' || sm.deliveryStatus === 'failed') return true;
        const isWithinWindow = remoteMessages.length < limit || sm.createdAt >= oldestRemoteTime;
        const matchesRemote =
          (sm.clientMessageId && (remoteClientIds.has(sm.clientMessageId) || remoteMongoIds.has(sm.clientMessageId))) ||
          ((sm as any)._id && remoteMongoIds.has(String((sm as any)._id)));

        if (isWithinWindow && !matchesRemote) {
          toPrune.push(sm.clientMessageId);
          return false;
        }
        return true;
      });

      if (toPrune.length > 0) {
        await deleteLocalMessagesBatch(conversationId, toPrune).catch(() => {});
      }
    }
  }

  const targetList = activeStored && activeStored.length > 0 ? activeStored : inMemoryDecrypted;

  // Build remote reaction lookup to ensure SQLite cache reflects latest reactions from server
  const remoteReactionMap = new Map<string, string>();
  for (const rm of remoteMessages) {
    if (rm.reactions && Array.isArray(rm.reactions) && rm.reactions.length > 0) {
      const json = JSON.stringify(rm.reactions);
      if (rm.clientMessageId) remoteReactionMap.set(rm.clientMessageId, json);
      if (rm._id) remoteReactionMap.set(String(rm._id), json);
    }
  }

  // Deduplicate before returning
  const seenIds = new Set<string>();
  const deduplicated: StoredMessage[] = [];
  for (const item of targetList) {
    const key = item.clientMessageId || `${item.sentAt}_${item.createdAt}`;
    if (!seenIds.has(key)) {
      seenIds.add(key);
      const latestReactionJson = remoteReactionMap.get(item.clientMessageId);
      if (latestReactionJson) {
        item.reactionJson = latestReactionJson;
      }
      deduplicated.push(item);
    }
  }
  deduplicated.sort((a, b) => (a.createdAt || a.sentAt || 0) - (b.createdAt || b.sentAt || 0));
  return deduplicated;
}
