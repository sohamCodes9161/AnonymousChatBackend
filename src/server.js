import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { app } from './app.js';
import { config } from './config/index.js';
import { connectDB } from './database/connect.js';

const httpServer = http.createServer(app);

// Socket.IO attaches to the SAME http server — not a separate port —
// so both REST and real-time traffic share one deployed service.
export const io = new SocketIOServer(httpServer, {
  cors: {
    origin: config.frontendUrl,
    credentials: true,
  },
});

// Socket auth middleware and event handlers land here once the
// Authentication and Real-Time modules are implemented, e.g.:
// io.use(socketAuthMiddleware);
// io.on('connection', handleConnection);

async function start() {
  await connectDB();

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
