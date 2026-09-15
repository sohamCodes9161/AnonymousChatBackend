import { Router } from 'express';
import * as chatsController from './chats.controller.js';
import * as messagesController from '../messages/messages.controller.js';
import * as groupsController from '../groups/groups.controller.js';
import * as incognitoController from '../incognito/incognito.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import {
  createDirectChatSchema,
  createGroupChatSchema,
  addMemberSchema,
  markReadSchema,
  muteSchema,
} from './chats.validation.js';
import { sendMessageSchema } from '../messages/messages.validation.js';
import { updateGroupInfoSchema } from '../groups/groups.validation.js';

const router = Router();

router.use(authenticate);

router.post('/direct', validate(createDirectChatSchema), chatsController.createDirectChat);
router.post('/group', validate(createGroupChatSchema), chatsController.createGroupChat);
router.get('/', chatsController.listMyChats);
router.get('/:chatId', chatsController.getChat);
router.patch('/:chatId', validate(updateGroupInfoSchema), groupsController.updateGroupInfo);
router.delete('/:chatId', groupsController.deleteGroup);
router.post('/:chatId/leave', groupsController.leaveGroup);
router.get('/:chatId/members', chatsController.listMembers);
router.post('/:chatId/members', validate(addMemberSchema), chatsController.addMember);
router.delete('/:chatId/members/:userId', groupsController.removeMember);
router.post('/:chatId/members/:userId/promote', groupsController.promoteToAdmin);
router.post('/:chatId/members/:userId/demote', groupsController.demoteAdmin);
router.post('/:chatId/read', validate(markReadSchema), chatsController.markRead);
router.post('/:chatId/mute', validate(muteSchema), chatsController.muteChat);
router.post('/:chatId/unmute', chatsController.unmuteChat);
router.post('/:chatId/archive', chatsController.archiveChat);
router.post('/:chatId/unarchive', chatsController.unarchiveChat);
router.get('/:chatId/incognito', incognitoController.getStatus);
router.post('/:chatId/incognito/start', incognitoController.start);
router.post('/:chatId/incognito/end', incognitoController.end);

// Messages nested under their chat for send/list — edit/delete act on
// a message directly, those live in messages.routes.js instead.
router.post('/:chatId/messages', validate(sendMessageSchema), messagesController.sendMessage);
router.get('/:chatId/messages', messagesController.listMessages);

export default router;
