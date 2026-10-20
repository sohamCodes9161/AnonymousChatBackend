import { deleteAssets, publicIdFromUrl } from './cloudinary.js';

// Message types that own a Cloudinary file. GIFs are GIPHY links (nothing
// of ours to delete); text/system have no media.
export const MEDIA_MESSAGE_TYPES = ['image', 'voice'];

/** { publicId, resourceType } for the Cloudinary asset a message owns, or null. */
export function mediaRefOfMessage(message) {
  if (!message) return null;
  if (message.type === 'image') {
    const publicId = message.content?.imagePublicId || publicIdFromUrl(message.content?.imageUrl);
    return publicId ? { publicId, resourceType: 'image' } : null;
  }
  if (message.type === 'voice') {
    const publicId = message.content?.audioPublicId || publicIdFromUrl(message.content?.audioUrl);
    return publicId ? { publicId, resourceType: 'video' } : null;
  }
  return null;
}

/** Deletes a list of refs, grouped per Cloudinary resource type. Non-fatal. */
export async function purgeMedia(refs) {
  const byType = new Map();
  for (const ref of refs || []) {
    if (!ref?.publicId) continue;
    if (!byType.has(ref.resourceType)) byType.set(ref.resourceType, []);
    byType.get(ref.resourceType).push(ref.publicId);
  }
  for (const [resourceType, ids] of byType) {
    await deleteAssets(ids, resourceType);
  }
}

export function mediaRefsOf(messages) {
  return (messages || []).map(mediaRefOfMessage).filter(Boolean);
}
