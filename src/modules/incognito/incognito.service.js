import mongoose from 'mongoose';
import { IncognitoSession } from './incognitoSession.model.js';
import { Chat } from '../chats/chat.model.js';
import { Message } from '../messages/message.model.js';
import { ChatMember } from '../chats/chatMember.model.js';
import * as chatsService from '../chats/chats.service.js';
import { isOnline } from '../../sockets/presence.js';
import { getIO } from '../../sockets/ioInstance.js';
import { AppError, ErrorCodes } from '../../utils/AppError.js';

const GRACE_PERIOD_MS = 2 * 60 * 1000; // 2 minutes

export async function startSession(userId, chatId) {
  // Symmetric permissions — any current member can start, no consent
  // gate, per the Incognito System design.
  await chatsService.assertMembership(chatId, userId);

  const chat = await Chat.findById(chatId);
  if (!chat) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Chat not found', 404);
  }

  // Idempotent start — a double-click or retry returns the existing
  // session rather than creating a duplicate.
  if (chat.activeIncognitoSessionId) {
    const existing = await IncognitoSession.findById(chat.activeIncognitoSessionId);
    if (existing && existing.status === 'active') return existing;
  }

  const session = await IncognitoSession.create({
    chatId,
    status: 'active',
    startedBy: userId,
    startedAt: new Date(),
  });

  chat.activeIncognitoSessionId = session._id;
  await chat.save();

  getIO().to(chatId).emit('incognito:started', {
    chatId,
    sessionId: session._id,
    startedBy: userId,
    startedAt: session.startedAt,
  });

  return session;
}

export async function endSession(userId, chatId) {
  // Same symmetric rule — any current member can end it, at any time,
  // bypassing the grace period entirely.
  await chatsService.assertMembership(chatId, userId);

  const chat = await Chat.findById(chatId);
  if (!chat?.activeIncognitoSessionId) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'No active incognito session', 404);
  }

  await finalizeSessionEnd(chat.activeIncognitoSessionId.toString());
}

/**
 * The actual cleanup — hard-deletes scoped messages (the one
 * deliberate exception to soft-delete elsewhere in this app), clears
 * the chat's pointer, marks the session ended. Called from both the
 * explicit end() path and the grace-period sweep job.
 */
export async function finalizeSessionEnd(sessionId) {
  const session = await IncognitoSession.findById(sessionId);
  if (!session || session.status === 'ended') return;

  const chatId = session.chatId.toString();
  const dbSession = await mongoose.startSession();
  try {
    await dbSession.withTransaction(async () => {
      await Message.deleteMany({ incognitoSessionId: session._id }, { session: dbSession });

      session.status = 'ended';
      session.endedAt = new Date();
      session.gracePeriodExpiresAt = null;
      await session.save({ session: dbSession });

      await Chat.findByIdAndUpdate(
        session.chatId,
        { activeIncognitoSessionId: null },
        { session: dbSession }
      );
    });
  } finally {
    dbSession.endSession();
  }

  getIO().to(chatId).emit('incognito:ended', { chatId, sessionId: session._id, endedAt: session.endedAt });
}

/**
 * Called from the Real-Time connection handler whenever presence
 * changes for any member of this chat. Triggers/cancels the grace
 * period based on how many CURRENT members are actively online right
 * now — not how many are still members (that's a separate, unrelated
 * question, per the Incognito System design).
 */
export async function reevaluateIncognitoPresence(chatId) {
  const chat = await Chat.findById(chatId);
  if (!chat?.activeIncognitoSessionId) return;

  const session = await IncognitoSession.findById(chat.activeIncognitoSessionId);
  if (!session || session.status !== 'active') return;

  const members = await ChatMember.find({ chatId, leftAt: null }).select('userId');
  const onlineCount = members.filter((m) => isOnline(m.userId.toString())).length;

  if (!session.gracePeriodExpiresAt && onlineCount < 2) {
    session.gracePeriodExpiresAt = new Date(Date.now() + GRACE_PERIOD_MS);
    await session.save();
    getIO().to(chatId).emit('incognito:grace_period_started', {
      chatId,
      sessionId: session._id,
      expiresAt: session.gracePeriodExpiresAt,
    });
  } else if (session.gracePeriodExpiresAt && onlineCount >= 2) {
    session.gracePeriodExpiresAt = null;
    await session.save();
    getIO().to(chatId).emit('incognito:grace_period_cancelled', { chatId, sessionId: session._id });
  }
}

export async function getActiveSession(userId, chatId) {
  await chatsService.assertMembership(chatId, userId);
  const chat = await Chat.findById(chatId);
  if (!chat?.activeIncognitoSessionId) return null;
  return IncognitoSession.findById(chat.activeIncognitoSessionId);
}
