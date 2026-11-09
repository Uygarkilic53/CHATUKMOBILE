import type { Response } from 'express';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { UploadApiResponse } from 'cloudinary';
import type { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import cloudinary from '../config/cloudinary.js';

/**
 * POST /api/uploads/sign
 * Generates server-signed upload parameters for direct client-side raw encrypted blob uploads to Cloudinary.
 * Follows E2EE_IMPLEMENTATION_SPEC.md Section 3.6 and Section 5.
 */
export const signUpload = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.id) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const timestamp = Math.round(new Date().getTime() / 1000);
    const public_id = `e2ee_${randomUUID()}`;

    const targetFolder =
      typeof req.body?.folder === 'string' && req.body.folder.startsWith('chatuk/')
        ? req.body.folder
        : 'chatuk/MessageMedia';

    // Cloudinary signed upload parameters for raw ciphertext blobs
    const paramsToSign = {
      timestamp,
      public_id,
      folder: targetFolder,
    };

    const config = cloudinary.config();
    if (!config.api_secret || !config.api_key || !config.cloud_name) {
      res.status(500).json({ error: 'Cloudinary credentials not properly configured on server' });
      return;
    }

    const signature = cloudinary.utils.api_sign_request(paramsToSign, config.api_secret);

    res.json({
      success: true,
      signature,
      timestamp,
      public_id,
      folder: targetFolder,
      api_key: config.api_key,
      cloud_name: config.cloud_name,
    });
  } catch (err: any) {
    console.error('[Upload] Error signing Cloudinary upload:', err);
    res.status(500).json({ error: 'Failed to sign upload parameters' });
  }
};

/**
 * POST /api/uploads/media
 * @deprecated Use client-side direct-to-Cloudinary upload via POST /api/uploads/sign (Sprint 4).
 * Kept as a resilient fallback for clients that cannot reach Cloudinary directly.
 */
export const uploadMedia = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.id) {
      res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
      return;
    }

    const targetFolder =
      typeof req.body?.folder === 'string' && req.body.folder.startsWith('chatuk/')
        ? req.body.folder
        : 'chatuk/MessageMedia';

    let uploadResult: UploadApiResponse;

    if (req.file) {
      const mime = req.file.mimetype || 'application/octet-stream';
      const isImage = mime.startsWith('image/');
      const isVideo = mime.startsWith('video/');
      const isAudio = mime.startsWith('audio/') || /\.(m4a|mp3|wav|aac|ogg|opus)$/i.test(req.file.originalname || '');
      const resourceType: 'image' | 'video' | 'auto' = isImage ? 'image' : (isVideo || isAudio) ? 'video' : 'auto';

      const ext = isImage ? '.jpg' : isVideo ? '.mp4' : isAudio ? '.m4a' : '.tmp';
      const tempPath = path.join(os.tmpdir(), `chatuk_media_${Date.now()}_${randomUUID()}${ext}`);
      await fs.promises.writeFile(tempPath, req.file.buffer);

      try {
        if (req.file.buffer.length > 15 * 1024 * 1024) {
          uploadResult = await new Promise<UploadApiResponse>((resolve, reject) => {
            cloudinary.uploader.upload_large(
              tempPath,
              {
                folder: targetFolder,
                resource_type: resourceType,
                chunk_size: 6 * 1024 * 1024,
                timeout: 300000,
              },
              (err, result) => {
                if (err) return reject(err);
                if (!result) return reject(new Error('Empty result from Cloudinary upload_large'));
                resolve(result);
              }
            );
          });
        } else {
          // Standard upload from local file path has exact Content-Length and avoids stream timeouts (499)
          uploadResult = await cloudinary.uploader.upload(tempPath, {
            folder: targetFolder,
            resource_type: resourceType,
            timeout: 180000,
          });
        }
      } finally {
        await fs.promises.unlink(tempPath).catch(() => {});
      }
    } else if (typeof req.body?.file === 'string' && req.body.file.trim().length > 0) {
      const fileToUpload = req.body.file.trim();
      const isVideo = fileToUpload.startsWith('data:video/') || /\.(mp4|mov|webm|m4v)(\?.*)?$/i.test(fileToUpload);
      const isImage = fileToUpload.startsWith('data:image/') || /\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i.test(fileToUpload);
      const isAudio = fileToUpload.startsWith('data:audio/') || /\.(m4a|mp3|wav|aac|ogg|opus)(\?.*)?$/i.test(fileToUpload);
      const resourceType: 'image' | 'video' | 'auto' = isImage ? 'image' : (isVideo || isAudio) ? 'video' : 'auto';

      uploadResult = await cloudinary.uploader.upload(fileToUpload, {
        folder: targetFolder,
        resource_type: resourceType,
        timeout: 180000,
      });
    } else if (typeof req.body?.media === 'string' && req.body.media.trim().length > 0) {
      const fileToUpload = req.body.media.trim();
      const isVideo = fileToUpload.startsWith('data:video/') || /\.(mp4|mov|webm|m4v)(\?.*)?$/i.test(fileToUpload);
      const isImage = fileToUpload.startsWith('data:image/') || /\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i.test(fileToUpload);
      const isAudio = fileToUpload.startsWith('data:audio/') || /\.(m4a|mp3|wav|aac|ogg|opus)(\?.*)?$/i.test(fileToUpload);
      const resourceType: 'image' | 'video' | 'auto' = isImage ? 'image' : (isVideo || isAudio) ? 'video' : 'auto';

      uploadResult = await cloudinary.uploader.upload(fileToUpload, {
        folder: targetFolder,
        resource_type: resourceType,
        timeout: 180000,
      });
    } else {
      res.status(400).json({
        error: 'No media file provided. Please upload a file via multipart form or provide a base64 payload.',
        code: 'MISSING_FILE',
      });
      return;
    }

    res.status(200).json({
      success: true,
      url: uploadResult.secure_url || uploadResult.url,
      publicId: uploadResult.public_id,
      resourceType: uploadResult.resource_type,
      width: uploadResult.width,
      height: uploadResult.height,
      duration: uploadResult.duration,
      format: uploadResult.format,
      bytes: uploadResult.bytes,
    });
  } catch (err: any) {
    console.error('[Upload] Error uploading media to Cloudinary:', err);
    res.status(500).json({
      error: err?.message || 'Failed to upload media to Cloudinary',
      code: 'UPLOAD_FAILED',
    });
  }
};

