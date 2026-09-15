import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as authController from './auth.controller.js';
import { validate } from '../../middleware/validate.js';
import { registerSchema, loginSchema } from './auth.validation.js';
import { config } from '../../config/index.js';
import { parseDuration } from '../../utils/token.js';

const router = Router();

// Stricter than the general app-wide limiter (app.js) — specifically
// targets credential-guessing / registration-spam, per Security module.
const authLimiter = rateLimit({
  windowMs: parseDuration(config.loginRateLimit.windowMs),
  max: config.loginRateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many attempts, try again later.' },
  },
});

router.post('/register', authLimiter, validate(registerSchema), authController.register);
router.post('/login', authLimiter, validate(loginSchema), authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);

export default router;
