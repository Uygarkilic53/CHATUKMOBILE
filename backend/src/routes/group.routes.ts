import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import {
  createGroup,
  getGroupDetails,
  updateGroupDetails,
  addParticipants,
  removeParticipant,
  changeAdminRole,
  leaveGroup,
} from '../controllers/group.controller.js';

const router = Router();

router.post('/', requireAuth, createGroup);
router.get('/:id', requireAuth, getGroupDetails);
router.put('/:id', requireAuth, updateGroupDetails);
router.post('/:id/participants', requireAuth, addParticipants);
router.delete('/:id/participants/:userId', requireAuth, removeParticipant);
router.put('/:id/admins/:userId', requireAuth, changeAdminRole);
router.post('/:id/leave', requireAuth, leaveGroup);

export default router;

