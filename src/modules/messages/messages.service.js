import { fileTypeFromBuffer } from 'file-type';
import { Message } from './message.model.js';
import { Chat } from '../chats/chat.model.js';
import { ChatMember } from '../chats/chatMember.model.js';
import * as chatsService from '../chats/chats.service.js';
import * as friendsService from '../friends/friends.service.js';
import {
  uploadImageBuffer,
  deleteAsset,
  publicIdFromUrl,
  CHAT_IMAGE_UPLOAD_OPTIONS,
} from '../../utils/cloudinary.js';
import { sanitizeGifContent } from '../../utils/giphy.js';
import { getReactionSummaryForMessages } from './reactions.service.js';
import { getIO } from '../../sockets/ioInstance.js';
import { AppError, ErrorCodes } from '../../utils/AppError.js';

const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Blocking never touches ChatMember, so an existing direct chat's
 * membership stays valid even after a block — this is the check that
 * actually stops new messages. Group chats are unaffected: blocking
 * doesn't remove someone from a shared group (Friend System design,
 * "not retroactive"). Shared between sendMessage and sendImageMessage
 * so the rule lives in exactly one place.
 */
async function assertNotBlocked(userId, chatId, chat) {
  if (chat.type !== 'direct') return;

  const otherMember = await ChatMember.findOne({ chatId, userId: { $ne: userId }, leftAt: null });
  if (!otherMember) return;

  const relationship = await friendsService.getRelationshipStatus(userId, otherMember.userId.toString());
  if (relationship.status === 'blocked_by_me' || relationship.status === 'blocked_by_them') {
    throw new AppError(ErrorCodes.CHAT_NOT_FRIENDS, 'Cannot send messages in this conversation', 403);
  }
}

function updateChatPreview(chat, userId, message, previewText) {
  chat.lastActivity = new Date();
  chat.lastMessageId = message._id;
  chat.lastMessageSenderId = userId;
  chat.lastMessagePreview = previewText;
}

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

  await assertNotBlocked(userId, chatId, chat);

  // Re-checked here (not only in the zod schema) so any future caller of
  // sendMessage can't bypass the GIPHY-only rule.
  if (type === 'gif') {
    content = sanitizeGifContent(content);
  } else if (type !== 'text') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, `Unsupported message type "${type}"`, 400);
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

  updateChatPreview(chat, userId, message, type === 'text' ? String(content?.text || '').slice(0, 100) : '🎞️ GIF');
  await chat.save();

  getIO().to(chatId.toString()).emit('message:new', { ...message.toPublicJSON(), reactions: [] });

  return message;
}

export async function sendImageMessage(userId, chatId, fileBuffer, caption) {
  await chatsService.assertMembership(chatId, userId);

  const chat = await Chat.findById(chatId);
  if (!chat) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Chat not found', 404);
  }

  await assertNotBlocked(userId, chatId, chat);

  // Same magic-byte rule as every other upload in this app — never
  // trust the client-declared Content-Type header.
  const detected = await fileTypeFromBuffer(fileBuffer);
  if (!detected || !ALLOWED_IMAGE_MIME_TYPES.includes(detected.mime)) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'File content does not match an allowed image type (JPEG, PNG, WEBP)',
      400
    );
  }

  const result = await uploadImageBuffer(
    `message-attachments/${chatId}`,
    fileBuffer,
    CHAT_IMAGE_UPLOAD_OPTIONS
  );

  const message = await Message.create({
    chatId,
    senderId: userId,
    type: 'image',
    content: {
      imageUrl: result.secure_url,
      imagePublicId: result.public_id,
      caption: caption || null,
    },
    incognitoSessionId: chat.activeIncognitoSessionId || null,
  });

  updateChatPreview(chat, userId, message, '📷 Photo');
  await chat.save();

  getIO().to(chatId.toString()).emit('message:new', { ...message.toPublicJSON(), reactions: [] });

  return message;
}

export async function listMessages(userId, chatId, { before, limit = 50 } = {}) {
  const member = await chatsService.assertMembership(chatId, userId);

  const query = { chatId };
  if (before) {
    query._id = { $lt: before };
  }
  if (member.clearedBefore) {
    query.createdAt = { ...(query.createdAt || {}), $gte: member.clearedBefore };
  }

  const cappedLimit = Math.min(limit, 100);
  const rows = await Message.find(query).sort({ _id: -1 }).limit(cappedLimit + 1);

  const hasMore = rows.length > cappedLimit;
  const page = hasMore ? rows.slice(0, cappedLimit) : rows;
  const nextCursor = hasMore ? page[page.length - 1]._id : null;
  const messages = page.reverse();

  const reactionsByMessageId = await getReactionSummaryForMessages(
    messages.map((m) => m._id.toString()),
    userId
  );

  return { messages, reactionsByMessageId, nextCursor, hasMore };
}

export async function searchMessages(userId, chatId, query) {
  const member = await chatsService.assertMembership(chatId, userId);

  const trimmed = (query || '').trim();
  if (trimmed.length < 2) return [];

  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const filter = {
    chatId,
    status: { $ne: 'deleted' },
    // Text messages match on text; photo messages on their caption.
    $or: [
      { 'content.text': { $regex: escaped, $options: 'i' } },
      { 'content.caption': { $regex: escaped, $options: 'i' } },
    ],
  };
  // Same boundary listMessages applies — "clear chat for me" must hide
  // history from search too, not just from the message list.
  if (member.clearedBefore) {
    filter.createdAt = { $gte: member.clearedBefore };
  }
  return Message.find(filter).sort({ _id: -1 }).limit(50);
}

export async function editMessage(userId, messageId, content) {
  const message = await Message.findById(messageId);
  if (!message || message.status === 'deleted') {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Message not found', 404);
  }
  if (message.senderId.toString() !== userId) {
    throw new AppError(ErrorCodes.AUTH_UNAUTHORIZED, 'Not authorized to edit this message', 403);
  }

  // Only text can be edited — assigning { text } would wipe an image or
  // GIF message's content.
  if (message.type !== 'text') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Only text messages can be edited', 400);
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

  // Capture before the content is wiped below. Photos sent before
  // public_ids were stored fall back to deriving it from the URL.
  const imagePublicId =
    message.type === 'image'
      ? message.content?.imagePublicId || publicIdFromUrl(message.content?.imageUrl)
      : null;

  message.status = 'deleted';
  message.deletedAt = new Date();
  message.content = { text: null };
  await message.save();

  // After the save, so a Cloudinary hiccup can never block the delete
  // the user asked for (deleteAsset swallows + logs its own errors).
  if (imagePublicId) deleteAsset(imagePublicId);

  getIO().to(message.chatId.toString()).emit('message:deleted', {
    id: message._id,
    chatId: message.chatId,
    deletedAt: message.deletedAt,
  });

  return message;
}
