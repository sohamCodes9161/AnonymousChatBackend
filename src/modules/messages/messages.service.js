import { Message } from './message.model.js';
import { Chat } from '../chats/chat.model.js';
import { ChatMember } from '../chats/chatMember.model.js';
import * as chatsService from '../chats/chats.service.js';
import * as friendsService from '../friends/friends.service.js';
import { getIO } from '../../sockets/ioInstance.js';
import { AppError, ErrorCodes } from '../../utils/AppError.js';

export async function sendMessage(userId, chatId, { type = 'text', content, clientMessageId, replyToMessageId }) {
  await chatsService.assertMembership(chatId, userId);

  if (clientMessageId) {
    const existing = await Message.findOne({ chatId, senderId: userId, clientMessageId });
    if (existing) return existing; // retried request — idempotent no-op
  }

  if (replyToMessageId) {
    const replyTarget = await Message.findOne({ _id: replyToMessageId, chatId });
    if (!replyTarget) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Reply target not found in this chat', 400);
    }
  }

  const chat = await Chat.findById(chatId);
  if (!chat) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Chat not found', 404);
  }

  // Blocking never touches ChatMember, so an existing direct chat's
  // membership stays valid even after a block — this is the check that
  // actually stops new messages. Group chats are unaffected: blocking
  // doesn't remove someone from a shared group (Friend System design,
  // "not retroactive").
  if (chat.type === 'direct') {
    const otherMember = await ChatMember.findOne({
      chatId,
      userId: { $ne: userId },
      leftAt: null,
    });
    if (otherMember) {
      const relationship = await friendsService.getRelationshipStatus(
        userId,
        otherMember.userId.toString()
      );
      if (relationship.status === 'blocked_by_me' || relationship.status === 'blocked_by_them') {
        throw new AppError(
          ErrorCodes.CHAT_NOT_FRIENDS,
          'Cannot send messages in this conversation',
          403
        );
      }
    }
  }

  const message = await Message.create({
    chatId,
    senderId: userId,
    type,
    content,
    replyToMessageId: replyToMessageId || null,
    clientMessageId: clientMessageId || null,
    incognitoSessionId: chat.activeIncognitoSessionId || null,
  });

  // Denormalized chat-list preview — updated on every send so the
  // chat list never needs to join against Messages to render itself.
  chat.lastActivity = new Date();
  chat.lastMessageId = message._id;
  chat.lastMessageSenderId = userId;
  chat.lastMessagePreview = type === 'text' ? String(content?.text || '').slice(0, 100) : `[${type}]`;
  await chat.save();

  getIO().to(chatId.toString()).emit('message:new', message.toPublicJSON());

  return message;
}

export async function listMessages(userId, chatId, { before, limit = 50 } = {}) {
  await chatsService.assertMembership(chatId, userId);

  const query = { chatId };
  if (before) {
    // ObjectId is time-ordered by construction — works directly as a
    // cursor without a separate sequence field.
    query._id = { $lt: before };
  }

  const cappedLimit = Math.min(limit, 100);
  const rows = await Message.find(query).sort({ _id: -1 }).limit(cappedLimit + 1);

  const hasMore = rows.length > cappedLimit;
  const page = hasMore ? rows.slice(0, cappedLimit) : rows;
  const nextCursor = hasMore ? page[page.length - 1]._id : null;

  // Reversed so the client renders oldest-to-newest without re-sorting.
  return { messages: page.reverse(), nextCursor, hasMore };
}

export async function editMessage(userId, messageId, content) {
  const message = await Message.findById(messageId);
  if (!message || message.status === 'deleted') {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Message not found', 404);
  }
  if (message.senderId.toString() !== userId) {
    throw new AppError(ErrorCodes.AUTH_UNAUTHORIZED, 'Not authorized to edit this message', 403);
  }

  message.content = content;
  message.status = 'edited';
  message.editedAt = new Date();
  await message.save();

  getIO().to(message.chatId.toString()).emit('message:edited', message.toPublicJSON());

  return message;
}

export async function deleteMessage(userId, messageId) {
  const message = await Message.findById(messageId);
  if (!message || message.status === 'deleted') {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Message not found', 404);
  }
  if (message.senderId.toString() !== userId) {
    throw new AppError(ErrorCodes.AUTH_UNAUTHORIZED, 'Not authorized to delete this message', 403);
  }

  // Soft delete — row stays for reply-thread integrity, content stripped.
  message.status = 'deleted';
  message.deletedAt = new Date();
  message.content = { text: null };
  await message.save();

  getIO().to(message.chatId.toString()).emit('message:deleted', {
    id: message._id,
    chatId: message.chatId,
    deletedAt: message.deletedAt,
  });

  return message;
}
