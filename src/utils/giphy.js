import { AppError, ErrorCodes } from './AppError.js';

/**
 * GIF messages store only links to GIPHY's CDN — nothing is uploaded or
 * re-hosted. Because clients choose these URLs, the server must make sure
 * a "gif" message can never point somewhere else (tracking pixels, other
 * people's servers, javascript: URLs, ...).
 *
 * The check parses the URL and compares the HOSTNAME; matching on the raw
 * string would let `https://giphy.com.evil.test/x` or
 * `https://media.giphy.com@evil.test/x` slip through.
 */
const MAX_URL_LENGTH = 800; // GIPHY CDN URLs carry long tracking query strings
const MAX_DIMENSION = 4000;

export function isAllowedGiphyUrl(value) {
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return host === 'giphy.com' || host.endsWith('.giphy.com');
}

/**
 * Builds the stored content from an explicit whitelist of fields, so
 * nothing extra a client sends ever reaches the database. Throws a 400
 * for anything that isn't a well-formed GIPHY reference.
 */
export function sanitizeGifContent(content) {
  const { gifUrl, previewUrl, width, height, title } = content || {};

  if (!isAllowedGiphyUrl(gifUrl) || !isAllowedGiphyUrl(previewUrl)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'GIF links must be https URLs on giphy.com', 400);
  }
  const validDim = (n) => Number.isInteger(n) && n > 0 && n <= MAX_DIMENSION;
  if (!validDim(width) || !validDim(height)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'GIF width and height are invalid', 400);
  }

  return {
    gifUrl,
    previewUrl,
    width,
    height,
    title: typeof title === 'string' ? title.slice(0, 200) : null,
  };
}
