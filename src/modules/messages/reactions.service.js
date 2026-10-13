import { MessageReaction } from './messageReaction.model.js';
import { Message } from './message.model.js';
import * as chatsService from '../chats/chats.service.js';
import { getIO } from '../../sockets/ioInstance.js';
import { AppError, ErrorCodes } from '../../utils/AppError.js';

// A fixed, small set — keeps the picker simple and avoids needing a
// full emoji library/keyboard on the frontend for this pass.
const ALLOWED_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export async function toggleReaction(userId, messageId, emoji) {
  if (!ALLOWED_EMOJIS.includes(emoji)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Unsupported reaction', 400);
  }

  const message = await Message.findById(messageId);
  if (!message || message.status === 'deleted') {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Message not found', 404);
  }
  const chatId = message.chatId.toString();
  await chatsService.assertMembership(chatId, userId);

  const existing = await MessageReaction.findOne({ messageId, userId, emoji });
  if (existing) {
    await existing.deleteOne();
  } else {
    await MessageReaction.create({ messageId, userId, emoji });
  }

  const reactionsByMessageId = await getReactionSummaryForMessages([messageId], userId);
  const reactions = reactionsByMessageId[messageId] || [];

  getIO().to(chatId).emit('message:reaction', { chatId, messageId, reactions });

  return reactions;
}

/**
 * Batch summary for a page of messages — one query for the whole page
 * rather than one per message. Returns a plain object keyed by message
 * id string (not a Map — this crosses into a JSON response, and Maps
 * don't serialize through res.json()).
 */
export async function getReactionSummaryForMessages(messageIds, currentUserId) {
  const rows = await MessageReaction.find({ messageId: { $in: messageIds } });

  const byMessage = {};
  for (const row of rows) {
    const msgId = row.messageId.toString();
    if (!byMessage[msgId]) byMessage[msgId] = {};
    const key = row.emoji;
    if (!byMessage[msgId][key]) {
      byMessage[msgId][key] = { emoji: row.emoji, count: 0, reactedByMe: false };
    }
    byMessage[msgId][key].count += 1;
    if (row.userId.toString() === currentUserId) byMessage[msgId][key].reactedByMe = true;
  }

  const result = {};
  for (const [msgId, byEmoji] of Object.entries(byMessage)) {
    result[msgId] = Object.values(byEmoji);
  }
  return result;
}
