import { Message } from '../modules/messages/message.model.js';
import { listAssetsByPrefix } from '../utils/cloudinary.js';
import { mediaRefOfMessage, purgeMedia } from '../utils/messageMedia.js';

const FIRST_RUN_DELAY_MS = 5 * 60 * 1000;
const INTERVAL_MS = 24 * 60 * 60 * 1000;
const MIN_AGE_MS = 24 * 60 * 60 * 1000; // never touch fresh uploads (in-flight sends)
const MAX_DELETES_PER_RUN = 200; // per resource type — a bug can't wipe everything at once

// Cloudinary folders that hold message media, and the message type that owns each.
const TARGETS = [
  { prefix: 'message-attachments/', resourceType: 'image', messageType: 'image' },
  { prefix: 'voice-messages/', resourceType: 'video', messageType: 'voice' },
];

/**
 * Safety net for the free Cloudinary plan. Every delete path already removes
 * its files, but a delete can fail (network blip, restart mid-request). This
 * finds message-media files that no message references any more and removes
 * them. Avatars are deliberately out of scope — only message folders.
 */
export async function runMediaSweep() {
  for (const { prefix, resourceType, messageType } of TARGETS) {
    const known = new Set();
    const cursor = Message.find({ type: messageType }).select('type content').lean().cursor();
    for await (const m of cursor) {
      const ref = mediaRefOfMessage(m);
      if (ref) known.add(ref.publicId);
    }

    const orphans = [];
    for await (const asset of listAssetsByPrefix(prefix, resourceType)) {
      if (known.has(asset.public_id)) continue;
      if (Date.now() - new Date(asset.created_at).getTime() < MIN_AGE_MS) continue;
      orphans.push({ publicId: asset.public_id, resourceType });
      if (orphans.length >= MAX_DELETES_PER_RUN) break;
    }

    if (orphans.length) {
      await purgeMedia(orphans);
      console.log(`Media sweep: removed ${orphans.length} orphaned ${resourceType} file(s) under ${prefix}`);
    }
  }
}

export function startMediaSweep() {
  if (process.env.MEDIA_SWEEP_ENABLED === 'false') return;
  const run = () =>
    runMediaSweep().catch((err) => console.error('Media sweep error:', err.message));
  setTimeout(() => {
    run();
    setInterval(run, INTERVAL_MS);
  }, FIRST_RUN_DELAY_MS);
}
