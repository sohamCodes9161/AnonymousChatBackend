import { v2 as cloudinary } from 'cloudinary';
import { config } from '../config/index.js';

cloudinary.config({
  cloud_name: config.cloudinary.cloudName,
  api_key: config.cloudinary.apiKey,
  api_secret: config.cloudinary.apiSecret,
});

/**
 * Uploads a file buffer directly to Cloudinary from the server —
 * the file never touches local disk (multer uses memory storage),
 * and the client never talks to Cloudinary directly. `folder` scopes
 * the asset (e.g. `avatars/{userId}` for a user, `group-avatars/{chatId}`
 * for a group) — same function, two callers.
 */
export function uploadImageBuffer(folder, buffer) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream({ folder }, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });
    uploadStream.end(buffer);
  });
}

/**
 * Deletes a previous avatar when it's replaced. Non-fatal by design —
 * an orphaned Cloudinary asset costs storage, not correctness, so a
 * delete failure is logged and swallowed rather than blocking the
 * user's request to set their new avatar.
 */
export async function deleteAsset(publicId) {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (err) {
    console.error('Failed to delete Cloudinary asset:', publicId, err.message);
  }
}
