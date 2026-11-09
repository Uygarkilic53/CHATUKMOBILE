import { Router } from 'express';
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import messageRoutes from './message.routes.js';
import groupRoutes from './group.routes.js';
import e2eeRoutes from './e2ee.routes.js';
import uploadRoutes from './upload.routes.js';
import contactRoutes from './contact.routes.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/user', userRoutes);
router.use('/messages', messageRoutes);
router.use('/groups', groupRoutes);
router.use('/e2ee', e2eeRoutes);
router.use('/uploads', uploadRoutes);
router.use('/contact', contactRoutes);

export default router;
