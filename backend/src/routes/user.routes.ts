import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.middleware.js';
import {
  updateProfilePicture,
  deleteProfilePicture,
  getProfile,
  updateTheme,
  updateBio,
  updateWallpaper,
  blockUser,
  unblockUser,
  getBlockedUsers,
  getPreferences,
  updatePreferences,
} from '../controllers/user.controller.js';

const router = Router();

// Configure multer with memory storage and 10MB file limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'));
    }
  },
});

// User profile routes
router.get('/profile', requireAuth, getProfile);
router.post('/profile-picture', requireAuth, upload.single('image'), updateProfilePicture);
router.delete('/profile-picture', requireAuth, deleteProfilePicture);
router.put('/theme', requireAuth, updateTheme);
router.put('/bio', requireAuth, updateBio);
router.put('/wallpaper', requireAuth, updateWallpaper);

// Block & Privacy routes
router.post('/block', requireAuth, blockUser);
router.post('/unblock', requireAuth, unblockUser);
router.get('/blocked', requireAuth, getBlockedUsers);

// User preferences routes
router.get('/preferences', requireAuth, getPreferences);
router.put('/preferences', requireAuth, updatePreferences);

export default router;
