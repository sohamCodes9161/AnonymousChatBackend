/**
 * Structured application error. Services throw this instead of a plain
 * Error so the centralized error handler can build the standard
 * { success: false, error: { code, message } } envelope without
 * guessing an HTTP status or a stable code from a string message.
 */
export class AppError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

// Central registry — grouped by module prefix, referenced by code
// everywhere (frontend branches on error.code, never error.message).
export const ErrorCodes = {
  // Auth
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_ACCOUNT_LOCKED: 'AUTH_ACCOUNT_LOCKED',
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  AUTH_USERNAME_TAKEN: 'AUTH_USERNAME_TAKEN',
  AUTH_UNAUTHORIZED: 'AUTH_UNAUTHORIZED',

  // Validation / generic
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
};
