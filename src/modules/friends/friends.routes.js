import { Router } from 'express';
import * as friendsController from './friends.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { sendRequestSchema } from './friends.validation.js';

const router = Router();

router.use(authenticate);

router.get('/', friendsController.listFriends);
router.get('/status/:userId', friendsController.getStatus);
router.get('/requests/incoming', friendsController.listIncoming);
router.get('/requests/outgoing', friendsController.listOutgoing);
router.get('/blocked', friendsController.listBlocked);

router.post('/requests', validate(sendRequestSchema), friendsController.sendRequest);
router.post('/requests/:requestId/accept', friendsController.acceptRequest);
router.post('/requests/:requestId/reject', friendsController.rejectRequest);
router.delete('/requests/:requestId', friendsController.cancelRequest);

router.delete('/:userId', friendsController.removeFriend);
router.post('/:userId/block', friendsController.blockUser);
router.delete('/:userId/block', friendsController.unblockUser);

export default router;
