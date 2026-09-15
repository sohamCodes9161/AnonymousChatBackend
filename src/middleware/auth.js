import { verifyAccessToken } from '../utils/jwt.js';
import { AppError, ErrorCodes } from '../utils/AppError.js';

export function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(new AppError(ErrorCodes.AUTH_UNAUTHORIZED, 'Missing access token', 401));
  }

  const token = header.slice(7);
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub };
    next();
  } catch {
    next(new AppError(ErrorCodes.AUTH_TOKEN_EXPIRED, 'Access token invalid or expired', 401));
  }
}
