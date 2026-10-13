import dotenv from 'dotenv';

// dotenv.config() only matters for local dev — Railway/production
// injects real env vars directly, this call is a harmless no-op there.
dotenv.config();

const required = [
  'mongoUrl',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'FRONTEND_URL',
];

const missing = required.filter((key) => !process.env[key]);

if (missing.length > 0) {
  // Fail fast at boot — never discover a missing secret the first time
  // a feature that needs it gets hit in production.
  throw new Error(
    `Missing required environment variables: ${missing.join(', ')}. ` +
      `Check .env.example for the full list.`
  );
}

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  isProduction: process.env.NODE_ENV === 'production',

  mongoUrl: process.env.mongoUrl,

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || '30d',
  },

  cookie: {
    // Deliberately no 'localhost' fallback. A cookie's Domain attribute
    // can only broaden scope to a PARENT domain of the host that set it —
    // it can never point at an unrelated host. Render (backend) and
    // Vercel (frontend) share no common parent domain, so the only
    // correct value here in that setup is "unset": leaving Domain off
    // the Set-Cookie header makes the browser default it to the exact
    // host that issued the cookie, which is what we want. Only set
    // COOKIE_DOMAIN at all if backend and frontend are deployed under
    // a shared parent domain (e.g. api.example.com + app.example.com
    // -> COOKIE_DOMAIN=.example.com).
    domain: process.env.COOKIE_DOMAIN || undefined,
    // SameSite=None (which production requires, below) is only honored
    // by browsers when Secure is also set — an insecure COOKIE_SECURE
    // env var in production would silently break the cookie the same
    // way the domain mismatch did, so production always forces this on
    // regardless of the env var; the env var only matters for local dev.
    secure:
      process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true',
  },

  argon2: {
    memoryCost: parseInt(process.env.ARGON2_MEMORY_COST || '19456', 10),
    timeCost: parseInt(process.env.ARGON2_TIME_COST || '2', 10),
  },

  frontendUrl: process.env.FRONTEND_URL,

  passwordReset: {
    tokenExpiry: process.env.PASSWORD_RESET_TOKEN_EXPIRY || '30m',
  },

  accountDeletion: {
    gracePeriodDays: parseInt(
      process.env.ACCOUNT_DELETION_GRACE_PERIOD_DAYS || '30',
      10
    ),
  },

  loginRateLimit: {
    maxAttempts: parseInt(process.env.LOGIN_MAX_ATTEMPTS || '5', 10),
    lockoutDuration: process.env.LOGIN_LOCKOUT_DURATION || '15m',
    windowMs: process.env.LOGIN_RATE_LIMIT_WINDOW || '15m',
    max: parseInt(process.env.LOGIN_RATE_LIMIT_MAX || '20', 10),
  },

  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
    avatarUploadPreset: process.env.CLOUDINARY_AVATAR_UPLOAD_PRESET,
  },
};
