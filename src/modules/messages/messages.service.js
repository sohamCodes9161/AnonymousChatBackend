import { fileTypeFromBuffer } from 'file-type';
import { Message } from './message.model.js';
import { Chat } from '../chats/chat.model.js';
import { ChatMember } from '../chats/chatMember.model.js';
import { User } from '../users/user.model.js';
import * as chatsService from '../chats/chats.service.js';
import * as friendsService from '../friends/friends.service.js';
import {
  uploadImageBuffer,
  uploadAudioBuffer,
  copyImageFromUrl,
  copyAssetFromUrl,
  CHAT_IMAGE_UPLOAD_OPTIONS,
} from '../../utils/cloudinary.js';
import { mediaRefOfMessage, mediaRefsOf, purgeMedia } from '../../utils/messageMedia.js';
import { sanitizeGifContent } from '../../utils/giphy.js';
import { getReactionSummaryForMessages } from './reactions.service.js';
import { getIO } from '../../sockets/ioInstance.js';
import { domainEventBus } from '../../events/domainEventBus.js';
import { AppError, ErrorCodes } from '../../utils/AppError.js';

const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// What file-type reports for the containers browsers' MediaRecorder produces
// (WebM/Ogg Opus on Chrome/Firefox, MP4/AAC on Safari), plus plain MP3. Mapped
// to the audio/* type a player should be told about.
const AUDIO_CONTAINERS = new Map([
  ['video/webm', 'audio/webm'],
  ['audio/webm', 'audio/webm'],
  ['audio/ogg', 'audio/ogg'],
  ['video/ogg', 'audio/ogg'],
  ['audio/opus', 'audio/ogg'],
  ['audio/mp4', 'audio/mp4'],
  ['video/mp4', 'audio/mp4'],
  ['audio/x-m4a', 'audio/mp4'],
  ['audio/mpeg', 'audio/mpeg'],
]);
export const MAX_VOICE_SECONDS = 300;

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

  const otherUser = await User.findById(otherMember.userId).select('deletedAt');
  if (otherUser?.deletedAt) {
    throw new AppError(ErrorCodes.CHAT_NOT_FRIENDS, 'This account no longer exists', 403);
  }

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

/**
 * A mention only counts when (a) the target is an active member of this
 * group, (b) it isn't the sender, and (c) "@username" really appears in
 * the text. (c) stops a client from silently pinging someone, and means an
 * edit that removes the @name also removes the mention.
 */
async function resolveMentions(chatId, senderId, text, candidateIds) {
  const ids = [...new Set((candidateIds || []).map(String))].filter((id) => id !== String(senderId));
  if (!ids.length || !text) return [];

  const members = await ChatMember.find({ chatId, userId: { $in: ids }, leftAt: null }).select('userId');
  const memberIds = members.map((m) => m.userId);
  if (!memberIds.length) return [];

  const users = await User.find({ _id: { $in: memberIds }, deletedAt: null }).select('username');
  const lower = text.toLowerCase();
  return users
    .filter((u) => {
      const tag = `@${u.username.toLowerCase()}`;
      let from = 0;
      for (;;) {
        const i = lower.indexOf(tag, from);
        if (i === -1) return false;
        const next = lower[i + tag.length];
        if (!next || !/[a-z0-9_]/.test(next)) return true; // whole-word match only
        from = i + 1;
      }
    })
    .map((u) => u._id);
}

function announceMentions(message, mentionIds, alreadyNotified = []) {
  const skip = new Set(alreadyNotified.map(String));
  for (const userId of mentionIds) {
    if (skip.has(String(userId))) continue;
    domainEventBus.emit('message.mentioned', {
      chatId: message.chatId.toString(),
      messageId: message._id.toString(),
      userId: userId.toString(),
      byUserId: message.senderId.toString(),
    });
  }
}

export async function sendMessage(
  userId,
  chatId,
  { type = 'text', content, clientMessageId, replyToMessageId, forwarded = false, mentions = [] }
) {
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

  const mentionIds =
    chat.type === 'group' && type === 'text' && !forwarded
      ? await resolveMentions(chatId, userId, content?.text, mentions)
      : [];

  const message = await Message.create({
    chatId,
    senderId: userId,
    type,
    content,
    replyToMessageId: replyToMessageId || null,
    clientMessageId: clientMessageId || null,
    incognitoSessionId: chat.activeIncognitoSessionId || null,
    forwarded,
    mentions: mentionIds,
  });

  updateChatPreview(chat, userId, message, type === 'text' ? String(content?.text || '').slice(0, 100) : '🎞️ GIF');
  await chat.save();

  getIO().to(chatId.toString()).emit('message:new', { ...message.toPublicJSON(), reactions: [] });
  announceMentions(message, mentionIds);

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

  return persistImageMessage({ userId, chatId, chat, result, caption });
}

async function persistImageMessage({ userId, chatId, chat, result, caption, forwarded = false }) {
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
    forwarded,
  });

  updateChatPreview(chat, userId, message, '📷 Photo');
  await chat.save();

  getIO().to(chatId.toString()).emit('message:new', { ...message.toPublicJSON(), reactions: [] });

  return message;
}

export async function sendVoiceMessage(userId, chatId, fileBuffer, durationSeconds) {
  await chatsService.assertMembership(chatId, userId);

  const duration = Math.round(Number(durationSeconds));
  if (!Number.isFinite(duration) || duration < 1 || duration > MAX_VOICE_SECONDS + 5) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Voice notes must be between 1 second and 5 minutes', 400);
  }

  const chat = await Chat.findById(chatId);
  if (!chat) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Chat not found', 404);
  }
  await assertNotBlocked(userId, chatId, chat);

  const detected = await fileTypeFromBuffer(fileBuffer);
  const mimeType = detected && AUDIO_CONTAINERS.get(detected.mime);
  if (!mimeType) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'File content is not a supported audio recording', 400);
  }

  const result = await uploadAudioBuffer(`voice-messages/${chatId}`, fileBuffer);
  return persistVoiceMessage({ userId, chatId, chat, result, duration, mimeType });
}

async function persistVoiceMessage({ userId, chatId, chat, result, duration, mimeType, forwarded = false }) {
  const message = await Message.create({
    chatId,
    senderId: userId,
    type: 'voice',
    content: { audioUrl: result.secure_url, audioPublicId: result.public_id, duration, mimeType },
    incognitoSessionId: chat.activeIncognitoSessionId || null,
    forwarded,
  });

  updateChatPreview(chat, userId, message, '🎤 Voice message');
  await chat.save();

  getIO().to(chatId.toString()).emit('message:new', { ...message.toPublicJSON(), reactions: [] });

  return message;
}

/**
 * Forwards messages from one chat into up to 5 others. Rules:
 *  - only text, GIF and photo messages (not deleted, not hidden for you);
 *  - Incognito messages can NEVER be forwarded — that would defeat the
 *    point of a volatile session;
 *  - photos are COPIED to a new Cloudinary asset, so deleting the original
 *    (or ending its Incognito session) doesn't break the forwarded copy;
 *  - each target goes through the normal send rules (membership, blocks,
 *    deleted accounts), so one bad target doesn't stop the others.
 * Returns which targets succeeded and which failed (and why).
 */
export async function forwardMessages(userId, sourceChatId, messageIds, targetChatIds) {
  await chatsService.assertMembership(sourceChatId, userId);

  const messages = await Message.find({
    _id: { $in: messageIds },
    chatId: sourceChatId,
    status: { $ne: 'deleted' },
    deletedFor: { $ne: userId },
    type: { $in: ['text', 'gif', 'image', 'voice'] },
  }).sort({ _id: 1 });

  if (!messages.length) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Nothing to forward', 400);
  }
  if (messages.some((m) => m.incognitoSessionId)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "Incognito messages can't be forwarded", 400);
  }

  const targets = [...new Set(targetChatIds.map(String))];
  const forwardedTo = [];
  const failures = [];

  for (const targetChatId of targets) {
    try {
      await chatsService.assertMembership(targetChatId, userId);
      const chat = await Chat.findById(targetChatId);
      if (!chat) throw new AppError(ErrorCodes.NOT_FOUND, 'Chat not found', 404);
      await assertNotBlocked(userId, targetChatId, chat);

      for (const m of messages) {
        if (m.type === 'image') {
          const result = await copyImageFromUrl(`message-attachments/${targetChatId}`, m.content?.imageUrl);
          await persistImageMessage({
            userId,
            chatId: targetChatId,
            chat: await Chat.findById(targetChatId), // fresh doc — previous save bumped it
            result,
            caption: m.content?.caption,
            forwarded: true,
          });
        } else if (m.type === 'voice') {
          const result = await copyAssetFromUrl(`voice-messages/${targetChatId}`, m.content?.audioUrl, 'video');
          await persistVoiceMessage({
            userId,
            chatId: targetChatId,
            chat: await Chat.findById(targetChatId),
            result,
            duration: m.content?.duration || 1,
            mimeType: m.content?.mimeType || 'audio/webm',
            forwarded: true,
          });
        } else {
          await sendMessage(userId, targetChatId, {
            type: m.type,
            content: m.type === 'text' ? { text: m.content?.text } : m.content,
            forwarded: true,
          });
        }
      }
      forwardedTo.push(targetChatId);
    } catch (err) {
      failures.push({
        chatId: targetChatId,
        message: err instanceof AppError ? err.message : 'Could not forward to this chat',
      });
    }
  }

  return { forwardedTo, failures };
}

export async function listMessages(userId, chatId, { before, limit = 50 } = {}) {
  const member = await chatsService.assertMembership(chatId, userId);

  const query = { chatId, deletedFor: { $ne: userId } };
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
    deletedFor: { $ne: userId },
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

/**
 * Global search across every chat the user is in. Respects each chat's
 * "clear chat" boundary, hides deleted / delete-for-me messages, and skips
 * Incognito messages (volatile by design — they shouldn't surface in a
 * persistent index). Capped; newest first.
 */
export async function searchAllMessages(userId, query) {
  const trimmed = (query || '').trim();
  if (trimmed.length < 2) return [];

  const memberships = await ChatMember.find({ userId, leftAt: null }).select('chatId clearedBefore');
  if (!memberships.length) return [];

  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = { $regex: escaped, $options: 'i' };

  const perChat = memberships.map((m) =>
    m.clearedBefore
      ? { chatId: m.chatId, createdAt: { $gte: m.clearedBefore } }
      : { chatId: m.chatId }
  );

  return Message.find({
    $and: [
      { $or: perChat },
      { $or: [{ 'content.text': rx }, { 'content.caption': rx }] },
    ],
    status: { $ne: 'deleted' },
    deletedFor: { $ne: userId },
    incognitoSessionId: null,
    type: { $in: ['text', 'image'] },
  })
    .sort({ _id: -1 })
    .limit(30);
}

export async function editMessage(userId, messageId, content, mentions = []) {
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

  const previousMentions = (message.mentions || []).map(String);
  const chat = await Chat.findById(message.chatId).select('type');
  message.mentions =
    chat?.type === 'group'
      ? await resolveMentions(message.chatId, userId, content?.text, mentions)
      : [];

  message.content = content;
  message.status = 'edited';
  message.editedAt = new Date();
  await message.save();

  getIO().to(message.chatId.toString()).emit('message:edited', message.toPublicJSON());
  announceMentions(message, message.mentions, previousMentions); // only NEW mentions notify

  return message;
}

/**
 * "Delete for me": hides messages from this user's view only. Nothing is
 * removed and nobody else is notified; the user's other open tabs/devices
 * are told so their lists update too. Works on anyone's messages (it's
 * only a personal hide), but is scoped to the chat the caller belongs to.
 */
export async function deleteMessagesForMe(userId, chatId, messageIds) {
  await chatsService.assertMembership(chatId, userId);

  const result = await Message.updateMany(
    { _id: { $in: messageIds }, chatId },
    { $addToSet: { deletedFor: userId } }
  );

  getIO().to(`user:${userId}`).emit('message:hidden', { chatId, messageIds });

  // Once EVERY current member has hidden a message, nobody can ever see it
  // again — drop the row and free its Cloudinary file instead of keeping an
  // unreachable asset on the (limited) free storage plan.
  await purgeFullyHiddenMedia(chatId, messageIds);

  return result.modifiedCount;
}

async function purgeFullyHiddenMedia(chatId, messageIds) {
  try {
    const candidates = await Message.find({
      _id: { $in: messageIds },
      chatId,
      type: { $in: ['image', 'voice'] },
      status: { $ne: 'deleted' },
    });
    if (!candidates.length) return;

    const members = await ChatMember.find({ chatId, leftAt: null }).select('userId');
    const memberIds = members.map((m) => m.userId.toString());
    if (!memberIds.length) return;

    const gone = candidates.filter((m) => {
      const hidden = new Set((m.deletedFor || []).map(String));
      return memberIds.every((id) => hidden.has(id));
    });
    if (!gone.length) return;

    await Message.deleteMany({ _id: { $in: gone.map((m) => m._id) } });
    await purgeMedia(mediaRefsOf(gone));
  } catch (err) {
    console.error('purgeFullyHiddenMedia failed:', err.message);
  }
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
  const mediaRef = mediaRefOfMessage(message);

  message.status = 'deleted';
  message.deletedAt = new Date();
  message.content = { text: null };
  await message.save();

  // After the save, so a Cloudinary hiccup can never block the delete
  // the user asked for (deleteAsset swallows + logs its own errors).
  if (mediaRef) purgeMedia([mediaRef]);

  getIO().to(message.chatId.toString()).emit('message:deleted', {
    id: message._id,
    chatId: message.chatId,
    deletedAt: message.deletedAt,
  });

  return message;
}
