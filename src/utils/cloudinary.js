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
 * Server-side copy of an existing Cloudinary image into a new asset (used
 * by Forward, so a forwarded photo survives the original being deleted).
 * Only our own Cloudinary delivery URLs are accepted — the URL comes from
 * the database, never from a client, but this keeps it from ever being
 * pointed at an arbitrary host.
 */
export async function copyImageFromUrl(folder, url) {
  return copyAssetFromUrl(folder, url, 'image', CHAT_IMAGE_UPLOAD_OPTIONS);
}

/**
 * Same as above for any asset type. Audio lives under Cloudinary's
 * "video" resource type, so voice copies pass resourceType 'video'.
 */
export async function copyAssetFromUrl(folder, url, resourceType = 'image', options = {}) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error('Invalid image URL');
  }
  if (host !== 'res.cloudinary.com') throw new Error('Not a Cloudinary URL');
  return cloudinary.uploader.upload(url, { folder, resource_type: resourceType, ...options });
}

/**
 * Deletes a previous avatar when it's replaced. Non-fatal by design —
 * an orphaned Cloudinary asset costs storage, not correctness, so a
 * delete failure is logged and swallowed rather than blocking the
 * user's request to set their new avatar.
 */
export async function deleteAsset(publicId, resourceType = 'image') {
  if (!publicId) return;
  try {
    // invalidate: purge the CDN's cached copy too — otherwise a deleted
    // image's URL can keep resolving from the edge cache for a while.
    await cloudinary.uploader.destroy(publicId, { invalidate: true, resource_type: resourceType });
  } catch (err) {
    console.error('Failed to delete Cloudinary asset:', publicId, err.message);
  }
}

/**
 * Bulk delete (Cloudinary caps one call at 100 ids). Same non-fatal
 * contract as deleteAsset — used when many images go at once, e.g. an
 * Incognito session ending.
 */
export async function deleteAssets(publicIds, resourceType = 'image') {
  const ids = (publicIds || []).filter(Boolean);
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    try {
      await cloudinary.api.delete_resources(chunk, { invalidate: true, resource_type: resourceType });
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

/**
 * Streams every asset under a folder prefix (Admin API, 500 per page).
 * Used only by the orphan sweep.
 */
export async function* listAssetsByPrefix(prefix, resourceType = 'image') {
  let nextCursor;
  do {
    const page = await cloudinary.api.resources({
      type: 'upload',
      resource_type: resourceType,
      prefix,
      max_results: 500,
      next_cursor: nextCursor,
    });
    for (const r of page.resources || []) yield r;
    nextCursor = page.next_cursor;
  } while (nextCursor);
}

/**
 * Uploads an audio buffer. Cloudinary files audio under resource_type
 * "video"; the original bytes are stored as-is (no transformation, so no
 * transformation credits are spent).
 */
export function uploadAudioBuffer(folder, buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'video' },
      (error, result) => (error ? reject(error) : resolve(result))
    );
    stream.end(buffer);
  });
}
