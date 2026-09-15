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
