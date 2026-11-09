import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import {
  createOrFindConversation,
  getConversations,
  getConversation,
  acceptConversation,
  denyConversation,
  getMessages,
  sendMessageHttp,
  clearConversation,
  deleteConversation,
  getConversationMedia,
  deleteMessage,
  toggleReaction,
  getMessageInfo,
} from '../controllers/message.controller.js';

const router = Router();

// Conversation routes
router.post('/conversations', requireAuth, createOrFindConversation);
router.get('/conversations', requireAuth, getConversations);
router.get('/conversations/:id', requireAuth, getConversation);
router.delete('/conversations/:id', requireAuth, deleteConversation);
router.post('/conversations/:id/accept', requireAuth, acceptConversation);
router.post('/conversations/:id/deny', requireAuth, denyConversation);
router.post('/conversations/:id/clear', requireAuth, clearConversation);
router.get('/conversations/:id/media', requireAuth, getConversationMedia);

// Messages within a conversation
router.get('/conversations/:id/messages', requireAuth, getMessages);
router.post('/conversations/:id/messages', requireAuth, sendMessageHttp);

// Message actions
router.get('/:id/info', requireAuth, getMessageInfo);
router.delete('/:id', requireAuth, deleteMessage);
router.post('/:id/reaction', requireAuth, toggleReaction);

export default router;
