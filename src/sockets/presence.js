// In-memory presence map for V1 — Map<userId, Set<socketId>>. "Online"
// means the set is non-empty, which is what makes this multi-device
// aware for free: two tabs from the same user don't flicker presence
// on and off as one of them reconnects.
//
// Scaling to multiple server instances later requires swapping this
// for Socket.IO's Redis adapter — an infrastructure change, not an
// application-logic one, since nothing above this file's interface
// needs to know how it's implemented.
const presenceMap = new Map();

/** Returns true if this is the user's first active connection. */
export function addConnection(userId, socketId) {
  if (!presenceMap.has(userId)) {
    presenceMap.set(userId, new Set());
  }
  const sockets = presenceMap.get(userId);
  const wasOffline = sockets.size === 0;
  sockets.add(socketId);
  return wasOffline;
}

/** Returns true if the user has no remaining active connections. */
export function removeConnection(userId, socketId) {
  const sockets = presenceMap.get(userId);
  if (!sockets) return false;

  sockets.delete(socketId);
  if (sockets.size === 0) {
    presenceMap.delete(userId);
    return true;
  }
  return false;
}

export function isOnline(userId) {
  const sockets = presenceMap.get(userId);
  return Boolean(sockets && sockets.size > 0);
}
