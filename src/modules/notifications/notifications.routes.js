import { Router } from 'express';
import * as notificationsController from './notifications.controller.js';
import { authenticate } from '../../middleware/auth.js';

const router = Router();

router.use(authenticate);

router.get('/', notificationsController.list);
router.get('/unread-count', notificationsController.unreadCount);
router.post('/:notificationId/read', notificationsController.markRead);
router.post('/read-all', notificationsController.markAllRead);

export default router;
