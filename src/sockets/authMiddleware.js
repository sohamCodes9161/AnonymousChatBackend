import { verifyAccessToken } from '../utils/jwt.js';

// Handshake auth — validated once, before the connection is accepted,
// same principle as the REST authenticate middleware but Socket.IO's
// own middleware shape (io.use), not Express's.
export function socketAuthMiddleware(socket, next) {
  const token = socket.handshake.auth?.token;

  if (!token) {
    return next(new Error('Missing access token'));
  }

  try {
    const payload = verifyAccessToken(token);
    socket.userId = payload.sub;
    next();
  } catch {
    next(new Error('Invalid or expired access token'));
  }
}
