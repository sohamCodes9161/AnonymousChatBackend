import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { app } from './app.js';
import { config } from './config/index.js';
import { connectDB } from './database/connect.js';
import { setIO } from './sockets/ioInstance.js';
import { socketAuthMiddleware } from './sockets/authMiddleware.js';
import { handleConnection } from './sockets/connectionHandler.js';
import { registerRealtimeNotificationBridge } from './sockets/notificationBridge.js';
import { registerNotificationListener } from './modules/notifications/notificationListener.js';
import { startIncognitoSweep } from './modules/incognito/sweepJob.js';

const httpServer = http.createServer(app);

// Socket.IO attaches to the SAME http server — not a separate port —
// so both REST and real-time traffic share one deployed service.
export const io = new SocketIOServer(httpServer, {
  cors: {
    origin: config.frontendUrl,
    credentials: true,
  },
});

setIO(io);
io.use(socketAuthMiddleware);
io.on('connection', (socket) => handleConnection(io, socket));

// Both subscribe to the same domain event bus independently — order
// between these two doesn't matter to each other, but both must come
// after setIO(io) since the real-time bridge calls getIO() internally.
registerRealtimeNotificationBridge();
registerNotificationListener();

async function start() {
  await connectDB();
  startIncognitoSweep();

  httpServer.listen(config.port, () => {
    console.log(`Server listening on port ${config.port} (${config.nodeEnv})`);
  });
}

start();

// Graceful shutdown — closes connections cleanly rather than dropping
// them, which matters the moment this runs somewhere that restarts
// processes routinely (Railway deploys, for instance).
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  httpServer.close(() => process.exit(0));
});
