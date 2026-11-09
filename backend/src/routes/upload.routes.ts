import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.middleware.js';
import { signUpload, uploadMedia } from '../controllers/upload.controller.js';

const router = Router();

const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit for media files (images & videos)
  },
});

router.post('/sign', requireAuth, signUpload);
router.post('/media', requireAuth, mediaUpload.single('file'), uploadMedia);

export default router;

