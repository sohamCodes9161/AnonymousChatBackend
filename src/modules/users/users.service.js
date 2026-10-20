import { fileTypeFromBuffer } from 'file-type';
import { User } from './user.model.js';
import crypto from 'crypto';
import { uploadImageBuffer, deleteAsset } from '../../utils/cloudinary.js';
import { mediaRefsOf, purgeMedia, MEDIA_MESSAGE_TYPES } from '../../utils/messageMedia.js';
import { verifyPassword, hashPassword } from '../../utils/password.js';
import { Message } from '../messages/message.model.js';
import { MessageReaction } from '../messages/messageReaction.model.js';
import { Chat } from '../chats/chat.model.js';
import { ChatMember } from '../chats/chatMember.model.js';
import { Friendship } from '../friends/friendship.model.js';
import { FriendRequest } from '../friends/friendRequest.model.js';
import { Block } from '../friends/block.model.js';
import { Notification } from '../notifications/notification.model.js';
import { UserSettings } from '../settings/userSettings.model.js';
import { RefreshToken } from '../auth/refreshToken.model.js';
import * as groupsService from '../groups/groups.service.js';
import { getIO } from '../../sockets/ioInstance.js';
import * as friendsService from '../friends/friends.service.js';
import { AppError, ErrorCodes } from '../../utils/AppError.js';

const ALLOWED_AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export async function getProfile(userId) {
  const user = await User.findById(userId);
  if (!user) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'User not found', 404);
  }
  return user;
}

export async function updateProfile(userId, updates) {
  const user = await User.findByIdAndUpdate(userId, updates, {
    new: true,
    runValidators: true,
  });
  if (!user) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'User not found', 404);
  }
  return user;
}

/**
 * One step, server-mediated: upload the buffer to Cloudinary, persist
 * the result, delete whatever avatar it replaced. No client-facing
 * signature/confirm dance — the server holds the Cloudinary credentials
 * and does the whole job itself.
 */
export async function uploadAvatar(userId, fileBuffer) {
  const user = await User.findById(userId);
  if (!user) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'User not found', 404);
  }

  // multer's fileFilter (middleware/upload.js) only ever sees the
  // client-declared Content-Type header — trivially spoofable by
  // renaming any file to end in .jpg. This is the check that can't be
  // faked: it inspects the actual leading bytes of the file.
  const detected = await fileTypeFromBuffer(fileBuffer);
  if (!detected || !ALLOWED_AVATAR_MIME_TYPES.includes(detected.mime)) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'File content does not match an allowed image type (JPEG, PNG, WEBP)',
      400
    );
  }

  const result = await uploadImageBuffer(`avatars/${userId}`, fileBuffer);
  const oldPublicId = user.avatarPublicId;

  user.avatarUrl = result.secure_url;
  user.avatarPublicId = result.public_id;
  await user.save();

  if (oldPublicId) {
    deleteAsset(oldPublicId); // fire-and-forget, already swallows its own errors
  }

  return user;
}

/**
 * Search module, V1 scope: username prefix match, block-aware. Reuses
 * the Friend System's own relationship resolver rather than
 * duplicating the block-check logic — same principle as everywhere
 * else in this codebase, one place owns a piece of logic.
 */
export async function searchUsers(currentUserId, query) {
  const trimmed = (query || '').trim();
  if (trimmed.length < 2) return [];

  const escaped = trimmed.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const candidates = await User.find({
    usernameLower: { $regex: '^' + escaped },
    _id: { $ne: currentUserId },
    deletedAt: null,
  }).limit(20);

  const results = [];
  for (const candidate of candidates) {
    const relationship = await friendsService.getRelationshipStatus(
      currentUserId,
      candidate._id.toString()
    );
    // Excluded, not just hidden — a blocked pair should never see each
    // other in search at all (Search module design decision).
    if (relationship.status === 'blocked_by_me' || relationship.status === 'blocked_by_them') {
      continue;
    }
    results.push({ user: candidate.toPublicJSON(), relationshipStatus: relationship.status });
  }

  return results;
}

/**
 * Account deletion. Password-confirmed. Semantics (deliberate):
 *  - everything the user SENT is hard-deleted, and their Cloudinary
 *    images/avatar are purged;
 *  - they leave every group (ownership succession runs as usual);
 *  - friendships, requests, blocks, notifications, settings and all
 *    sessions are removed;
 *  - the User row itself is ANONYMISED and kept, so other people's direct
 *    chats still have a valid participant ("Deleted account") and nothing
 *    dangles; the username is freed for re-registration.
 */
export async function deleteAccount(userId, password) {
  const user = await User.findById(userId);
  if (!user || user.deletedAt) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'User not found', 404);
  }

  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) {
    // 403, not 401 — the client treats 401 as "session expired" and logs out.
    throw new AppError(ErrorCodes.AUTH_INVALID_CREDENTIALS, 'Incorrect password', 403);
  }

  const io = getIO();

  // 1. Leave groups.
  const memberships = await ChatMember.find({ userId, leftAt: null }).populate('chatId', 'type');
  for (const m of memberships) {
    if (m.chatId?.type === 'group') {
      try {
        await groupsService.leaveGroup(userId, m.chatId._id.toString());
      } catch {
        /* best effort — keep deleting */
      }
    }
  }

  // 2. Purge sent messages (+ their images) and reactions.
  const sent = await Message.find({ senderId: userId }).select('_id chatId type content');
  const chatIds = new Set(sent.map((m) => m.chatId.toString()));
  const mediaRefs = mediaRefsOf(sent.filter((m) => MEDIA_MESSAGE_TYPES.includes(m.type)));
  const sentIds = sent.map((m) => m._id);
  await MessageReaction.deleteMany({ $or: [{ userId }, { messageId: { $in: sentIds } }] });
  await Message.deleteMany({ senderId: userId });
  await purgeMedia(mediaRefs);

  // Chat previews that pointed at one of the purged messages.
  await Chat.updateMany(
    { lastMessageSenderId: userId },
    { $set: { lastMessageId: null, lastMessagePreview: null } }
  );

  // 3. Relationship + account data.
  await Promise.all([
    Friendship.deleteMany({ $or: [{ userAId: userId }, { userBId: userId }] }),
    FriendRequest.deleteMany({ $or: [{ fromUserId: userId }, { toUserId: userId }] }),
    Block.deleteMany({ $or: [{ blockerId: userId }, { blockedId: userId }] }),
    Notification.deleteMany({ userId }),
    UserSettings.deleteMany({ userId }),
    RefreshToken.deleteMany({ userId }),
  ]);

  // 4. Anonymise the user row.
  const oldAvatar = user.avatarPublicId;
  const suffix = crypto.randomBytes(6).toString('hex');
  user.username = `deleted_${suffix}`;
  user.usernameLower = `deleted_${suffix}`;
  user.displayName = 'Deleted account';
  user.bio = '';
  user.avatarUrl = null;
  user.avatarPublicId = null;
  user.lastSeenAt = null;
  user.passwordHash = await hashPassword(crypto.randomBytes(32).toString('hex'));
  user.deletedAt = new Date();
  await user.save();
  if (oldAvatar) deleteAsset(oldAvatar);

  // 5. Tell everyone affected, then drop the user's sockets.
  for (const chatId of chatIds) {
    io.to(chatId).emit('messages:purged', { chatId, senderId: userId.toString() });
  }
  const counterparts = await ChatMember.find({
    chatId: { $in: [...chatIds] },
    userId: { $ne: userId },
    leftAt: null,
  }).distinct('userId');
  for (const other of counterparts) {
    io.to(`user:${other}`).emit('chats:refresh');
  }
  io.in(`user:${userId}`).disconnectSockets(true);

  return { deleted: true };
}
