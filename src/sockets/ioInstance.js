// A minimal singleton accessor for the Socket.IO server instance.
// Lets service-layer code (messages.service.js, systemMessage.js) emit
// real-time events without those modules importing server.js directly
// or Real-Time System importing business logic — avoids a circular
// dependency while staying simple (the full domain event bus is
// reserved for Notification System's Friend/Group decoupling need,
// not needed here for straightforward message broadcast).
let ioInstance = null;

export function setIO(io) {
  ioInstance = io;
}

export function getIO() {
  if (!ioInstance) {
    throw new Error('Socket.IO has not been initialized yet');
  }
  return ioInstance;
}
