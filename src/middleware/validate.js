import { AppError, ErrorCodes } from '../utils/AppError.js';

export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const message = result.error.errors[0]?.message || 'Invalid request body';
      return next(new AppError(ErrorCodes.VALIDATION_ERROR, message, 400));
    }
    req.body = result.data;
    next();
  };
}
