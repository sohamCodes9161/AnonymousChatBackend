import { IncognitoSession } from './incognitoSession.model.js';
import { finalizeSessionEnd } from './incognito.service.js';

const SWEEP_INTERVAL_MS = 15_000;

/**
 * Grace periods are persisted (gracePeriodExpiresAt on the session
 * row), not held in server memory — this sweep is what actually acts
 * on that expiry. A server restart never leaves a session stuck: the
 * timestamp survives, and the next sweep tick picks it up correctly.
 */
export function startIncognitoSweep() {
  setInterval(async () => {
    try {
      const expired = await IncognitoSession.find({
        status: 'active',
        gracePeriodExpiresAt: { $ne: null, $lte: new Date() },
      });
      for (const session of expired) {
        await finalizeSessionEnd(session._id.toString());
      }
    } catch (err) {
      console.error('Incognito sweep error:', err);
    }
  }, SWEEP_INTERVAL_MS);
}
