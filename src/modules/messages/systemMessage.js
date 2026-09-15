import { Message } from './message.model.js';
import { Chat } from '../chats/chat.model.js';
import { getIO } from '../../sockets/ioInstance.js';

/**
 * Group membership/role changes emit a system message into the chat's
 * normal message stream — this is what makes the message-type
 * abstraction from the design phase actually pull weight, not just
 * exist theoretically.
 */
export async function createSystemMessage(chatId, event, data = {}) {
  const message = await Message.create({
    chatId,
    type: 'system',
    content: { event, ...data },
  });

  await Chat.findByIdAndUpdate(chatId, {
    lastActivity: new Date(),
    lastMessageId: message._id,
    lastMessageSenderId: null,
    lastMessagePreview: `[system] ${event}`,
  });

  getIO().to(chatId.toString()).emit('message:new', message.toPublicJSON());

  return message;
}
