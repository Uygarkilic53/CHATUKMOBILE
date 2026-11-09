import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import {
  registerDevice,
  getUserActiveDevices,
  getConversationRecipients,
  uploadBackup,
  getBackup,
  deleteBackup,
} from '../controllers/e2ee.controller.js';

const router = Router();

router.post('/devices', requireAuth, registerDevice);
router.get('/users/:userId/devices', requireAuth, getUserActiveDevices);
router.get('/conversations/:id/recipients', requireAuth, getConversationRecipients);

// Zero-knowledge encrypted cloud backup endpoints
router.post('/backup', requireAuth, uploadBackup);
router.get('/backup', requireAuth, getBackup);
router.delete('/backup', requireAuth, deleteBackup);

export default router;

