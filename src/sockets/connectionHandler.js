import { ChatMember } from '../modules/chats/chatMember.model.js';
import * as friendsService from '../modules/friends/friends.service.js';
import { reevaluateIncognitoPresence } from '../modules/incognito/incognito.service.js';
import { addConnection, removeConnection } from './presence.js';

const TYPING_TTL_MS = 5000;

async function broadcastPresenceToFriends(io, userId, event) {
  const friends = await friendsService.listFriends(userId);
  // Scoped to friends only — broadcasting presence to every connected
  // client regardless of relationship would leak online/offline status
  // to strangers (Privacy, section 28 of the original design brief).
  friends.forEach((friend) => {
    io.to(`user:${friend._id}`).emit(event, { userId });
  });
}

export async function handleConnection(io, socket) {
  const userId = socket.userId;

  // Personal room — lets other code (presence broadcast, future
  // targeted notifications) reach every socket this user has open,
  // without tracking socket ids directly outside presence.js.
  socket.join(`user:${userId}`);

  // Join one room per chat currently a member of. Re-runs on every
  // reconnect, which is exactly the catch-up mechanism this needs —
  // no separate "missed events" replay required.
  const memberships = await ChatMember.find({ userId, leftAt: null }).select('chatId');
  memberships.forEach((m) => socket.join(m.chatId.toString()));

  const justCameOnline = addConnection(userId, socket.id);
  if (justCameOnline) {
    await broadcastPresenceToFriends(io, userId, 'presence:online');
    // Presence recovering might cancel an active grace period on any
    // chat this user belongs to — reevaluate all of them.
    for (const m of memberships) {
      await reevaluateIncognitoPresence(m.chatId.toString());
    }
  }

  // Per-socket typing timers — cleared on renewal, so the TTL is the
  // real source of truth, not an explicit stop event (Real-Time design).
  const typingTimers = new Map();

  socket.on('typing:start', ({ chatId }) => {
    if (!socket.rooms.has(chatId)) return; // not a member — silently ignore
    socket.to(chatId).emit('typing:start', { chatId, userId });

    clearTimeout(typingTimers.get(chatId));
    const timer = setTimeout(() => {
      socket.to(chatId).emit('typing:stop', { chatId, userId });
      typingTimers.delete(chatId);
    }, TYPING_TTL_MS);
    typingTimers.set(chatId, timer);
  });

  socket.on('typing:stop', ({ chatId }) => {
    clearTimeout(typingTimers.get(chatId));
    typingTimers.delete(chatId);
    socket.to(chatId).emit('typing:stop', { chatId, userId });
  });

  socket.on('disconnect', async () => {
    typingTimers.forEach((timer) => clearTimeout(timer));
    typingTimers.clear();

    const justWentOffline = removeConnection(userId, socket.id);
    if (justWentOffline) {
      await broadcastPresenceToFriends(io, userId, 'presence:offline');
      // Presence dropping might trigger a grace period on any chat
      // this user belongs to — reevaluate all of them.
      for (const m of memberships) {
        await reevaluateIncognitoPresence(m.chatId.toString());
      }
    }
  });
}
