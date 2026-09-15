import { Router } from 'express';
import * as messagesController from './messages.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { editMessageSchema } from './messages.validation.js';

const router = Router();

router.use(authenticate);

router.patch('/:messageId', validate(editMessageSchema), messagesController.editMessage);
router.delete('/:messageId', messagesController.deleteMessage);

export default router;
