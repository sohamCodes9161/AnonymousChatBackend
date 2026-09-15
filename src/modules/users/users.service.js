import { fileTypeFromBuffer } from 'file-type';
import { User } from './user.model.js';
import { uploadAvatarBuffer, deleteAsset } from '../../utils/cloudinary.js';
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

  const result = await uploadAvatarBuffer(userId, fileBuffer);
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
