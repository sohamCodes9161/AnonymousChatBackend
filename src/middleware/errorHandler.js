import { randomUUID } from 'crypto';
import multer from 'multer';
import mongoose from 'mongoose';
import { AppError, ErrorCodes } from '../utils/AppError.js';

/**
 * Assigns a request id to every incoming request, used for log
 * correlation. Attached before anything else in the middleware stack.
 */
export function requestId(req, res, next) {
  req.id = randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

/**
 * Catches any route that didn't match — returns the same envelope
 * shape as every other error, not a bare Express default page.
 */
export function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: {
      code: ErrorCodes.NOT_FOUND,
      message: `No route matches ${req.method} ${req.originalUrl}`,
    },
  });
}

/**
 * Must be registered LAST — Express identifies error middleware by
 * its four-argument signature.
 *
 * Deliberately never logs req.body or any message/token content
 * (Security module's logging rule) — only the request id, path, and
 * error code/message are safe to log.
 */
export function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    console.error(`[${req.id}] ${err.code}: ${err.message}`);
    return res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message },
    });
  }

  if (err instanceof multer.MulterError) {
    console.error(`[${req.id}] ${err.code}: ${err.message}`);
    return res.status(400).json({
      success: false,
      error: { code: ErrorCodes.VALIDATION_ERROR, message: err.message },
    });
  }

  if (err instanceof mongoose.Error.CastError) {
    return res.status(400).json({
      success: false,
      error: {
        code: ErrorCodes.VALIDATION_ERROR,
        message: `Invalid ${err.path}: "${err.value}" is not a valid id`,
      },
    });
  }

  // Unexpected error — log it, but never leak internal detail to the client.
  console.error(`[${req.id}] Unhandled error:`, err);
  res.status(500).json({
    success: false,
    error: {
      code: ErrorCodes.INTERNAL_ERROR,
      message: 'Something went wrong. Please try again.',
    },
  });
}
