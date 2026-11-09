import type { Response } from 'express';
import mongoose from 'mongoose';
import { ObjectId } from 'mongodb';
import cloudinary from '../config/cloudinary.js';
import type { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { getIO } from '../socket.js';
import { invalidateUserSessionCache } from '../config/redis.js';

const getUserFilter = (userId: string, email?: string): any => {
  const orConditions: any[] = [{ _id: userId }];
  if (ObjectId.isValid(userId)) {
    orConditions.push({ _id: new ObjectId(userId) });
  }
  if (email) {
    orConditions.push({ email });
  }
  return { $or: orConditions };
};

export const updateProfilePicture = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }

    if (!mongoose.connection.db) {
      return res.status(500).json({ error: 'Database connection unavailable', code: 'DB_ERROR' });
    }

    const db = mongoose.connection.db;
    const userFilter = getUserFilter(req.user.id, req.user.email);

    // Find current user to check for existing avatarPublicId
    const currentUser = await db.collection('user').findOne(userFilter);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
    }

    let fileToUpload: string;

    if (req.file) {
      // Multer memory storage
      const b64 = Buffer.from(req.file.buffer).toString('base64');
      const mime = req.file.mimetype || 'image/jpeg';
      fileToUpload = `data:${mime};base64,${b64}`;
    } else if (typeof req.body?.image === 'string' && req.body.image.trim().length > 0) {
      const img = req.body.image.trim();
      if (img.startsWith('data:')) {
        fileToUpload = img;
      } else if (img.startsWith('http://') || img.startsWith('https://')) {
        fileToUpload = img;
      } else {
        fileToUpload = `data:image/jpeg;base64,${img}`;
      }
    } else {
      return res.status(400).json({
        error: 'No image provided. Please upload an image file or provide a base64 payload.',
        code: 'MISSING_IMAGE',
      });
    }

    // If previous image exists in Cloudinary, delete it
    if (currentUser.avatarPublicId) {
      try {
        await cloudinary.uploader.destroy(currentUser.avatarPublicId);
        console.log(`Deleted previous Cloudinary image: ${currentUser.avatarPublicId}`);
      } catch (delErr) {
        console.warn('Failed to delete previous Cloudinary image:', delErr);
      }
    }

    // Upload new image to Cloudinary
    const uploadResult = await cloudinary.uploader.upload(fileToUpload, {
      folder: 'chatuk/avatars',
      transformation: [
        { width: 500, height: 500, crop: 'fill', gravity: 'face', quality: 'auto', fetch_format: 'auto' },
      ],
      resource_type: 'image',
    });

    // Update user in MongoDB
    await db.collection('user').updateOne(userFilter, {
      $set: {
        image: uploadResult.secure_url,
        avatarPublicId: uploadResult.public_id,
        updatedAt: new Date(),
      },
    });

    // Invalidate Redis session cache so next request fetches fresh image
    await invalidateUserSessionCache(req.user.id);

    const updatedUser = await db.collection('user').findOne(userFilter);

    return res.status(200).json({
      success: true,
      message: 'Profile picture updated successfully',
      imageUrl: uploadResult.secure_url,
      publicId: uploadResult.public_id,
      user: {
        id: updatedUser?._id.toString(),
        name: updatedUser?.name,
        email: updatedUser?.email,
        image: updatedUser?.image,
      },
    });
  } catch (error: any) {
    console.error('Error updating profile picture:', error);
    return res.status(500).json({
      error: error.message || 'Failed to upload profile picture',
      code: 'UPLOAD_FAILED',
    });
  }
};

export const deleteProfilePicture = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }

    if (!mongoose.connection.db) {
      return res.status(500).json({ error: 'Database connection unavailable', code: 'DB_ERROR' });
    }

    const db = mongoose.connection.db;
    const userFilter = getUserFilter(req.user.id, req.user.email);

    const currentUser = await db.collection('user').findOne(userFilter);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
    }

    // Delete image from Cloudinary if it exists
    if (currentUser.avatarPublicId) {
      try {
        await cloudinary.uploader.destroy(currentUser.avatarPublicId);
        console.log(`Deleted Cloudinary image: ${currentUser.avatarPublicId}`);
      } catch (delErr) {
        console.warn('Failed to delete Cloudinary image:', delErr);
      }
    }

    // Clear image and avatarPublicId fields in user document
    await db.collection('user').updateOne(userFilter, {
      $set: {
        image: null,
        avatarPublicId: null,
        updatedAt: new Date(),
      },
    });

    // Invalidate Redis session cache
    await invalidateUserSessionCache(req.user.id);

    const updatedUser = await db.collection('user').findOne(userFilter);

    return res.status(200).json({
      success: true,
      message: 'Profile picture deleted successfully',
      user: {
        id: updatedUser?._id.toString(),
        name: updatedUser?.name,
        email: updatedUser?.email,
        image: null,
      },
    });
  } catch (error: any) {
    console.error('Error deleting profile picture:', error);
    return res.status(500).json({
      error: error.message || 'Failed to delete profile picture',
      code: 'DELETE_FAILED',
    });
  }
};

export const getProfile = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }

    if (!mongoose.connection.db) {
      return res.status(500).json({ error: 'Database connection unavailable', code: 'DB_ERROR' });
    }

    const db = mongoose.connection.db;
    const userFilter = getUserFilter(req.user.id, req.user.email);

    const user = await db.collection('user').findOne(userFilter);
    if (!user) {
      return res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        image: user.image && typeof user.image === 'string' && user.image.trim().length > 0 ? user.image.trim() : null,
        avatarPublicId: user.avatarPublicId || null,
        theme: user.theme || 'obsidian-sky',
        bio: user.bio || '',
        wallpaper: user.wallpaper || 'default',
        wallpaperUpdatedAt: user.wallpaperUpdatedAt ? new Date(user.wallpaperUpdatedAt).getTime() : null,
        createdAt: user.createdAt,
      },
    });
  } catch (error: any) {
    console.error('Error fetching profile:', error);
    return res.status(500).json({
      error: error.message || 'Failed to fetch user profile',
      code: 'FETCH_FAILED',
    });
  }
};

export const updateBio = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }

    const { bio } = req.body;
    if (typeof bio !== 'string') {
      return res.status(400).json({ error: 'Valid bio string is required', code: 'INVALID_BIO' });
    }

    if (!mongoose.connection.db) {
      return res.status(500).json({ error: 'Database connection unavailable', code: 'DB_ERROR' });
    }

    const db = mongoose.connection.db;
    const userFilter = getUserFilter(req.user.id, req.user.email);

    const updateResult = await db.collection('user').updateOne(userFilter, {
      $set: {
        bio: bio.trim(),
        updatedAt: new Date(),
      },
    });

    if (updateResult.matchedCount === 0) {
      return res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
    }

    // Invalidate Redis session cache
    await invalidateUserSessionCache(req.user.id);

    return res.status(200).json({
      success: true,
      message: 'Bio updated successfully',
      bio: bio.trim(),
    });
  } catch (error: any) {
    console.error('Error updating bio:', error);
    return res.status(500).json({
      error: error.message || 'Failed to update bio',
      code: 'UPDATE_FAILED',
    });
  }
};

export const updateTheme = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }

    const { theme } = req.body;
    if (!theme || typeof theme !== 'string') {
      return res.status(400).json({ error: 'Valid theme identifier is required', code: 'INVALID_THEME' });
    }

    if (!mongoose.connection.db) {
      return res.status(500).json({ error: 'Database connection unavailable', code: 'DB_ERROR' });
    }

    const db = mongoose.connection.db;
    const userFilter = getUserFilter(req.user.id, req.user.email);

    const updateResult = await db.collection('user').updateOne(userFilter, {
      $set: {
        theme,
        updatedAt: new Date(),
      },
    });

    if (updateResult.matchedCount === 0) {
      return res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
    }

    // Invalidate Redis session cache
    await invalidateUserSessionCache(req.user.id);

    return res.status(200).json({
      success: true,
      message: 'Theme preference updated successfully',
      theme,
    });
  } catch (error: any) {
    console.error('Error updating theme preference:', error);
    return res.status(500).json({
      error: error.message || 'Failed to update theme preference',
      code: 'UPDATE_FAILED',
    });
  }
};

export const blockUser = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }
    const { targetUserId } = req.body;
    if (!targetUserId) {
      return res.status(400).json({ error: 'targetUserId is required', code: 'MISSING_TARGET' });
    }
    if (!mongoose.connection.db) {
      return res.status(500).json({ error: 'Database connection unavailable', code: 'DB_ERROR' });
    }

    const db = mongoose.connection.db;
    const userFilter = getUserFilter(req.user.id, req.user.email);
    const targetObjId = ObjectId.isValid(targetUserId) ? new ObjectId(targetUserId) : targetUserId;

    await db.collection('user').updateOne(userFilter, {
      $addToSet: { blockedUsers: targetObjId } as any,
      $set: { updatedAt: new Date() },
    });

    return res.status(200).json({
      success: true,
      message: 'User blocked successfully',
      targetUserId,
    });
  } catch (error: any) {
    console.error('Error blocking user:', error);
    return res.status(500).json({
      error: error.message || 'Failed to block user',
      code: 'BLOCK_FAILED',
    });
  }
};

export const unblockUser = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }
    const { targetUserId } = req.body;
    if (!targetUserId) {
      return res.status(400).json({ error: 'targetUserId is required', code: 'MISSING_TARGET' });
    }
    if (!mongoose.connection.db) {
      return res.status(500).json({ error: 'Database connection unavailable', code: 'DB_ERROR' });
    }

    const db = mongoose.connection.db;
    const userFilter = getUserFilter(req.user.id, req.user.email);
    const targetObjId = ObjectId.isValid(targetUserId) ? new ObjectId(targetUserId) : null;

    const pullCondition = targetObjId
      ? { $in: [targetObjId, targetUserId] }
      : targetUserId;

    await db.collection('user').updateOne(userFilter, {
      $pull: { blockedUsers: pullCondition } as any,
      $set: { updatedAt: new Date() },
    });

    return res.status(200).json({
      success: true,
      message: 'User unblocked successfully',
      targetUserId,
    });
  } catch (error: any) {
    console.error('Error unblocking user:', error);
    return res.status(500).json({
      error: error.message || 'Failed to unblock user',
      code: 'UNBLOCK_FAILED',
    });
  }
};

export const getBlockedUsers = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }
    if (!mongoose.connection.db) {
      return res.status(500).json({ error: 'Database connection unavailable', code: 'DB_ERROR' });
    }

    const db = mongoose.connection.db;
    const userFilter = getUserFilter(req.user.id, req.user.email);
    const user = await db.collection('user').findOne(userFilter);

    const blockedRaw = user?.blockedUsers || [];
    const blockedIds: string[] = blockedRaw.map((b: any) => b.toString());

    let populatedUsers: Array<{ id: string; name: string; email: string; image: string | null }> = [];
    if (blockedIds.length > 0) {
      const objectIds = blockedIds
        .filter((id) => ObjectId.isValid(id))
        .map((id) => new ObjectId(id));

      const foundUsers = await db
        .collection<{ _id: ObjectId | string; name?: string; email?: string; image?: string }>('user')
        .find({
          $or: [
            ...(objectIds.length > 0 ? [{ _id: { $in: objectIds } }] : []),
            { _id: { $in: blockedIds } },
          ],
        })
        .project({ name: 1, email: 1, image: 1 })
        .toArray();

      populatedUsers = foundUsers.map((u: any) => ({
        id: u._id.toString(),
        name: u.name || 'Unknown User',
        email: u.email || '',
        image: u.image || null,
      }));
    }

    return res.status(200).json({
      success: true,
      blockedUserIds: blockedIds,
      blockedUsers: populatedUsers,
    });
  } catch (error: any) {
    console.error('Error fetching blocked users:', error);
    return res.status(500).json({
      error: error.message || 'Failed to fetch blocked users',
      code: 'FETCH_FAILED',
    });
  }
};

export const getPreferences = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }
    if (!mongoose.connection.db) {
      return res.status(500).json({ error: 'Database connection unavailable', code: 'DB_ERROR' });
    }

    const db = mongoose.connection.db;
    const userFilter = getUserFilter(req.user.id, req.user.email);
    const user = await db.collection('user').findOne(userFilter);

    const defaultPreferences = {
      readReceipts: true,
      showLastSeen: true,
      inAppSounds: true,
      sentMessageSound: true,
      senderTone: 'sending1',
      receiverTone: 'default',
      notificationTone: 'default',
      vibration: true,
      hapticFeedback: true,
      inAppBanners: true,
      messagePreview: true,
      callRingtone: true,
      callVibration: true,
    };

    const preferences = {
      ...defaultPreferences,
      ...(user?.preferences || {}),
    };

    return res.status(200).json({
      success: true,
      preferences,
    });
  } catch (error: any) {
    console.error('Error fetching user preferences:', error);
    return res.status(500).json({
      error: error.message || 'Failed to fetch preferences',
      code: 'FETCH_FAILED',
    });
  }
};

export const updatePreferences = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }
    if (!mongoose.connection.db) {
      return res.status(500).json({ error: 'Database connection unavailable', code: 'DB_ERROR' });
    }

    const { preferences } = req.body;
    if (!preferences || typeof preferences !== 'object') {
      return res.status(400).json({ error: 'Preferences object is required', code: 'INVALID_PREFERENCES' });
    }

    const db = mongoose.connection.db;
    const userFilter = getUserFilter(req.user.id, req.user.email);
    const user = await db.collection('user').findOne(userFilter);
    if (!user) {
      return res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
    }

    const merged = {
      ...(user.preferences || {}),
      ...preferences,
      updatedAt: new Date(),
    };

    await db.collection('user').updateOne(userFilter, {
      $set: {
        preferences: merged,
        updatedAt: new Date(),
      },
    });

    return res.status(200).json({
      success: true,
      preferences: merged,
    });
  } catch (error: any) {
    console.error('Error updating user preferences:', error);
    return res.status(500).json({
      error: error.message || 'Failed to update preferences',
      code: 'UPDATE_FAILED',
    });
  }
};

export const updateWallpaper = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }

    const { wallpaperId, updatedAt } = req.body;
    if (!wallpaperId || typeof wallpaperId !== 'string') {
      return res.status(400).json({ error: 'Valid wallpaperId is required', code: 'INVALID_WALLPAPER' });
    }

    if (!mongoose.connection.db) {
      return res.status(500).json({ error: 'Database connection unavailable', code: 'DB_ERROR' });
    }

    const db = mongoose.connection.db;
    const userFilter = getUserFilter(req.user.id, req.user.email);
    const user = await db.collection('user').findOne(userFilter);
    if (!user) {
      return res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
    }

    const clientUpdatedAt = typeof updatedAt === 'number' ? new Date(updatedAt) : new Date();
    const serverUpdatedAt = user.wallpaperUpdatedAt ? new Date(user.wallpaperUpdatedAt) : null;

    // Last-Write-Wins: if server has newer timestamp, report conflict
    if (serverUpdatedAt && serverUpdatedAt.getTime() > clientUpdatedAt.getTime()) {
      return res.status(200).json({
        success: false,
        conflict: true,
        serverWallpaper: user.wallpaper || 'default',
        serverUpdatedAt: serverUpdatedAt.getTime(),
      });
    }

    await db.collection('user').updateOne(userFilter, {
      $set: {
        wallpaper: wallpaperId,
        wallpaperUpdatedAt: clientUpdatedAt,
        updatedAt: new Date(),
      },
    });

    // Broadcast Socket.IO event to user's personal room
    try {
      const io = getIO();
      const userIdStr = user._id.toString();
      io.to(`user:${userIdStr}`).emit('wallpaper_updated', {
        wallpaperId,
        updatedAt: clientUpdatedAt.getTime(),
      });
      if (req.user.id && req.user.id !== userIdStr) {
        io.to(`user:${req.user.id}`).emit('wallpaper_updated', {
          wallpaperId,
          updatedAt: clientUpdatedAt.getTime(),
        });
      }
    } catch (socketErr) {
      console.warn('[updateWallpaper] Socket broadcast warning:', socketErr);
    }

    return res.status(200).json({
      success: true,
      wallpaper: wallpaperId,
      updatedAt: clientUpdatedAt.getTime(),
    });
  } catch (error: any) {
    console.error('Error updating wallpaper:', error);
    return res.status(500).json({
      error: error.message || 'Failed to update wallpaper',
      code: 'UPDATE_FAILED',
    });
  }
};




