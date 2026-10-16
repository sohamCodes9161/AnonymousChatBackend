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
export function uploadImageBuffer(folder, buffer, options = {}) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream({ folder, ...options }, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });
    uploadStream.end(buffer);
  });
}

/**
 * Incoming transformation for chat photos: applied at upload time and
 * only the TRANSFORMED result is stored (the original is discarded), so
 * this is a server-side guarantee on stored size even if a client skips
 * its own compression. `limit` only ever shrinks, never upscales.
 */
export const CHAT_IMAGE_UPLOAD_OPTIONS = {
  transformation: [{ width: 1600, height: 1600, crop: 'limit', quality: 'auto:good' }],
};

/**
 * Deletes a previous avatar when it's replaced. Non-fatal by design —
 * an orphaned Cloudinary asset costs storage, not correctness, so a
 * delete failure is logged and swallowed rather than blocking the
 * user's request to set their new avatar.
 */
export async function deleteAsset(publicId) {
  if (!publicId) return;
  try {
    // invalidate: purge the CDN's cached copy too — otherwise a deleted
    // image's URL can keep resolving from the edge cache for a while.
    await cloudinary.uploader.destroy(publicId, { invalidate: true });
  } catch (err) {
    console.error('Failed to delete Cloudinary asset:', publicId, err.message);
  }
}

/**
 * Bulk delete (Cloudinary caps one call at 100 ids). Same non-fatal
 * contract as deleteAsset — used when many images go at once, e.g. an
 * Incognito session ending.
 */
export async function deleteAssets(publicIds) {
  const ids = (publicIds || []).filter(Boolean);
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    try {
      await cloudinary.api.delete_resources(chunk, { invalidate: true });
    } catch (err) {
      console.error('Failed to bulk delete Cloudinary assets:', err.message);
    }
  }
}

/**
 * Recovers a public_id from a delivery URL — only for photos uploaded
 * before public_ids were stored on messages. URL shape:
 *   https://res.cloudinary.com/<cloud>/image/upload/[transforms/]v123/<folder>/<name>.<ext>
 */
export function publicIdFromUrl(url) {
  if (typeof url !== 'string') return null;
  const match = url.match(/\/upload\/(?:[^/]+\/)*?v\d+\/(.+)\.[a-zA-Z0-9]+(?:\?.*)?$/);
  return match ? match[1] : null;
}
