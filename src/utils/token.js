import crypto from 'crypto';

export function generateRawToken() {
  return crypto.randomBytes(40).toString('hex');
}

export function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Parses env-style duration strings ("15m", "30d", "45s") into
 * milliseconds. Used anywhere we need an actual Date/ms value rather
 * than jsonwebtoken's expiresIn (which accepts these strings natively
 * but only for signing, not for cookie maxAge or lockout timestamps).
 */
export function parseDuration(str) {
  const match = /^(\d+)(s|m|h|d)$/.exec(str);
  if (!match) {
    throw new Error(`Invalid duration string: "${str}" (expected e.g. "15m", "30d")`);
  }
  const value = parseInt(match[1], 10);
  const multipliers = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * multipliers[match[2]];
}
