import multer from 'multer';
import { AppError, ErrorCodes } from '../utils/AppError.js';

// Memory storage — the buffer goes straight to Cloudinary, never to
// local disk. Matters on Railway specifically: its filesystem is
// ephemeral, so writing to disk would be pointless anyway.
const storage = multer.memoryStorage();

const ALLOWED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function fileFilter(req, file, cb) {
  if (!ALLOWED_AVATAR_TYPES.includes(file.mimetype)) {
    return cb(
      new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'Only JPEG, PNG, and WEBP images are allowed',
        400
      )
    );
  }
  cb(null, true);
}

export const avatarUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter,
}).single('avatar'); // form field name the client must use

// Message attachments get more headroom than avatars — a photo shared
// in chat is reasonably expected to be larger than a profile picture.
export const messageImageUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter,
}).single('image');

// Voice notes: ~5 min of low-bitrate Opus/AAC is ~1-3MB, so 6MB is generous.
export const MAX_VOICE_BYTES = 6 * 1024 * 1024;
export const voiceUpload = multer({
  storage,
  limits: { fileSize: MAX_VOICE_BYTES },
}).single('audio'); // type is verified from the bytes in the service, not the header
