import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { config } from './config/index.js';
import { requestId, notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import authRouter from './modules/auth/auth.routes.js';
import usersRouter from './modules/users/users.routes.js';
import friendsRouter from './modules/friends/friends.routes.js';
import chatsRouter from './modules/chats/chats.routes.js';
import messagesRouter from './modules/messages/messages.routes.js';
import notificationsRouter from './modules/notifications/notifications.routes.js';
import settingsRouter from './modules/settings/settings.routes.js';

export const app = express();

// 1. Request ID — first, so every subsequent log line can be correlated
app.use(requestId);

// 2. Secure headers
app.use(helmet());

// 3. CORS — restricted to the known frontend origin, credentials enabled
//    so the refresh-token cookie can actually be sent cross-origin
app.use(
  cors({
    origin: config.frontendUrl,
    credentials: true,
  })
);

// 4. Body parsing
app.use(express.json());
app.use(cookieParser());

// 5. General rate limiter — a coarse baseline; individual routers
//    (auth, friends) layer stricter limits on top of this per Security module
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// Health check — the first thing to verify once this boots
app.get('/health', (req, res) => {
  res.json({ success: true, data: { status: 'ok', env: config.nodeEnv } });
});

// 6. Module routers
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/users', usersRouter);
app.use('/api/v1/friends', friendsRouter);
app.use('/api/v1/chats', chatsRouter);
app.use('/api/v1/messages', messagesRouter);
app.use('/api/v1/notifications', notificationsRouter);
app.use('/api/v1/settings', settingsRouter);

// Unmatched routes
app.use(notFoundHandler);

// 7. Centralized error handler — must be last
app.use(errorHandler);
