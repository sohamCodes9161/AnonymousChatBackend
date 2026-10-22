import mongoose from 'mongoose';
import { Chat } from './chat.model.js';
import { ChatMember } from './chatMember.model.js';
import { Message } from '../messages/message.model.js';
import { User } from '../users/user.model.js';
import { UserSettings } from '../settings/userSettings.model.js';
import { Block } from '../friends/block.model.js';
import { createSystemMessage } from '../messages/systemMessage.js';
import { domainEventBus } from '../../events/domainEventBus.js';
import { getIO } from '../../sockets/ioInstance.js';
import * as friendsService from '../friends/friends.service.js';
import { sortPair } from '../../utils/pair.js';
import { AppError, ErrorCodes } from '../../utils/AppError.js';

/**
 * The single most-repeated authorization check in the app. Every
 * message send, every chat action, calls this first. Deliberately a
 * plain lookup, not cached — correctness here matters more than
 * shaving a query.
 */
export async function assertMembership(chatId, userId) {
  const member = await ChatMember.findOne({ chatId, userId, leftAt: null });
  if (!member) {
    throw new AppError(ErrorCodes.CHAT_NOT_MEMBER, 'Not a member of this chat', 403);
  }
  return member;
}

async function assertFriends(userIdA, userIdB, message) {
  const relationship = await friendsService.getRelationshipStatus(userIdA, userIdB);
  if (relationship.status !== 'friends') {
    throw new AppError(ErrorCodes.CHAT_NOT_FRIENDS, message, 403);
  }
}

export async function getOrCreateDirectChat(currentUserId, otherUserId) {
  if (currentUserId === otherUserId) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Cannot start a chat with yourself', 400);
  }

  await assertFriends(currentUserId, otherUserId, 'You can only message friends');

  const [a, b] = sortPair(currentUserId, otherUserId);
  const directPairKey = `${a}_${b}`;

  const existing = await Chat.findOne({ type: 'direct', directPairKey });
  if (existing) return existing;

  const session = await mongoose.startSession();
  let chat;
  try {
    await session.withTransaction(async () => {
      const created = await Chat.create([{ type: 'direct', directPairKey }], {
        session,
        ordered: true,
      });
      chat = created[0];
      await ChatMember.insertMany(
        [
          { chatId: chat._id, userId: a },
          { chatId: chat._id, userId: b },
        ],
        { session }
      );
    });
  } catch (err) {
    if (err.code === 11000) {
      // Race: two simultaneous requests both tried to create it —
      // whoever lost just fetches what the winner created.
      chat = await Chat.findOne({ type: 'direct', directPairKey });
    } else {
      throw err;
    }
  } finally {
    session.endSession();
  }

  return chat;
}

export async function createGroupChat(creatorId, { name, memberIds = [] }) {
  const uniqueMemberIds = [...new Set(memberIds)].filter((id) => id !== creatorId);

  // Friends-only at the door: the creator must be friends with every
  // initial member. Not retroactively enforced later — see Chat System
  // design decision.
  for (const memberId of uniqueMemberIds) {
    await assertFriends(creatorId, memberId, 'You can only add friends to a group');
  }

  const session = await mongoose.startSession();
  let chat;
  try {
    await session.withTransaction(async () => {
      const created = await Chat.create([{ type: 'group', name }], { session, ordered: true });
      chat = created[0];

      const members = [
        { chatId: chat._id, userId: creatorId, role: 'owner' },
        ...uniqueMemberIds.map((id) => ({ chatId: chat._id, userId: id, role: 'member' })),
      ];
      await ChatMember.insertMany(members, { session });
    });
  } finally {
    session.endSession();
  }

  await createSystemMessage(chat._id.toString(), 'group_created', { userId: creatorId });

  return chat;
}

export async function addGroupMember(currentUserId, chatId, newMemberId) {
  const chat = await Chat.findById(chatId);
  if (!chat || chat.type !== 'group') {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Group chat not found', 404);
  }

  // The adder must be a current member — but per design, any member
  // (not just admin/owner) can add, as long as the friends-only check
  // holds for THEM specifically, not any existing member.
  await assertMembership(chatId, currentUserId);
  await assertFriends(currentUserId, newMemberId, 'You can only add your own friends to a group');

  const existing = await ChatMember.findOne({ chatId, userId: newMemberId });
  if (existing && !existing.leftAt) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'User is already a member', 409);
  }
  if (existing && existing.leftAt) {
    // Rejoining — per design, they get access to full history again,
    // not a fresh start.
    existing.leftAt = null;
    existing.joinedAt = new Date();
    await existing.save();
    await createSystemMessage(chatId, 'member_added', { userId: newMemberId });
    domainEventBus.emit('group.member.added', { chatId, userId: newMemberId, addedBy: currentUserId });
    return existing;
  }

  const created = await ChatMember.create({ chatId, userId: newMemberId, role: 'member' });
  await createSystemMessage(chatId, 'member_added', { userId: newMemberId });
  domainEventBus.emit('group.member.added', { chatId, userId: newMemberId, addedBy: currentUserId });
  return created;
}

export async function listMyChats(userId) {
  const memberships = await ChatMember.find({ userId, leftAt: null });
  const membershipByChat = new Map(memberships.map((m) => [m.chatId.toString(), m]));
  const chatIds = memberships.map((m) => m.chatId);
  const chats = await Chat.find({ _id: { $in: chatIds } });

  // Pinned first (most recently pinned first), then the rest by
  // activity — sorted here rather than in the DB query since it's a
  // small in-memory list per user, not worth a compound index for.
  chats.sort((a, b) => {
    const aPinned = membershipByChat.get(a._id.toString())?.pinnedAt;
    const bPinned = membershipByChat.get(b._id.toString())?.pinnedAt;
    if (aPinned && bPinned) return bPinned - aPinned;
    if (aPinned) return -1;
    if (bPinned) return 1;
    return b.lastActivity - a.lastActivity;
  });

  // For direct chats specifically: resolve the OTHER participant's
  // profile AND their current read position (lastReadMessageId) — the
  // latter is what lets the frontend compute read-tick status without
  // a separate endpoint.
  const directChatIds = chats.filter((c) => c.type === 'direct').map((c) => c._id);
  const otherMembers = await ChatMember.find({
    chatId: { $in: directChatIds },
    userId: { $ne: userId },
  }).populate('userId', 'username displayName avatarUrl lastSeenAt deletedAt');
  const otherUserByChat = new Map(
    otherMembers.map((m) => [
      m.chatId.toString(),
      { ...m.userId.toObject(), lastReadMessageId: m.lastReadMessageId },
    ])
  );

  // Privacy: batch-fetch settings for the current user (their own
  // read-receipts opt-in matters too — standard convention, turning
  // yours off also hides others') and every other participant.
  const otherUserIds = [...otherUserByChat.values()].map((u) => u._id.toString());
  const settingsRows = await UserSettings.find({ userId: { $in: [userId, ...otherUserIds] } });
  const settingsByUserId = new Map(settingsRows.map((s) => [s.userId.toString(), s]));
  const myReadReceiptsEnabled = settingsByUserId.get(userId)?.privacy?.readReceiptsEnabled ?? true;

  // Blocked pairs (either direction) must not see each other's last seen
  // or read position, whatever the privacy settings say.
  const blockRows = await Block.find({
    $or: [
      { blockerId: userId, blockedId: { $in: otherUserIds } },
      { blockedId: userId, blockerId: { $in: otherUserIds } },
    ],
  });
  const blockedWith = new Set(
    blockRows.map((b) => (b.blockerId.toString() === userId ? b.blockedId : b.blockerId).toString())
  );

  // 'friends' visibility tier needs a relationship lookup — resolved
  // here, as a pre-pass, so the final map below stays synchronous and
  // never has to smuggle intermediate state through the return value.
  const friendsTierChatIds = [];
  for (const [chatIdStr, otherUser] of otherUserByChat.entries()) {
    const visibility = settingsByUserId.get(otherUser._id.toString())?.privacy?.lastSeenVisibility;
    if (visibility === 'friends') friendsTierChatIds.push(chatIdStr);
  }
  const friendsTierResolved = new Map(
    await Promise.all(
      friendsTierChatIds.map(async (chatIdStr) => {
        const otherUser = otherUserByChat.get(chatIdStr);
        const relationship = await friendsService.getRelationshipStatus(
          userId,
          otherUser._id.toString()
        );
        return [chatIdStr, relationship.status === 'friends' ? otherUser.lastSeenAt : null];
      })
    )
  );

  // Group chats: resolve who sent the last message, so the sidebar can
  // prefix the preview with their name (e.g. "User B: hey what's up").
  const senderIds = chats
    .filter((c) => c.type === 'group' && c.lastMessageSenderId)
    .map((c) => c.lastMessageSenderId);
  const senders = await User.find({ _id: { $in: senderIds } }).select('displayName');
  const senderNameById = new Map(senders.map((u) => [u._id.toString(), u.displayName]));

  // Unread badge counts: messages from others after my read position
  // (and after "clear chat"), capped at 100 so a huge backlog costs one
  // bounded query per chat rather than a full count.
  const unreadByChat = new Map(
    await Promise.all(
      chats.map(async (chat) => {
        const m = membershipByChat.get(chat._id.toString());
        const filter = {
          chatId: chat._id,
          senderId: { $ne: userId },
          status: { $ne: 'deleted' },
          deletedFor: { $ne: userId },
        };
        if (m.lastReadMessageId) filter._id = { $gt: m.lastReadMessageId };
        if (m.clearedBefore) filter.createdAt = { $gte: m.clearedBefore };
        const count = await Message.countDocuments(filter).limit(100);
        return [chat._id.toString(), count];
      })
    )
  );

  return chats.map((chat) => {
    const chatIdStr = chat._id.toString();
    const membership = membershipByChat.get(chatIdStr);
    const otherUser = chat.type === 'direct' ? otherUserByChat.get(chatIdStr) : null;
    const lastMessageSenderName =
      chat.type === 'group' && chat.lastMessageSenderId
        ? senderNameById.get(chat.lastMessageSenderId.toString()) || null
        : null;

    let otherParticipant = null;
    if (otherUser) {
      const otherSettings = settingsByUserId.get(otherUser._id.toString());
      const theirReadReceiptsEnabled = otherSettings?.privacy?.readReceiptsEnabled ?? true;
      const lastSeenVisibility = otherSettings?.privacy?.lastSeenVisibility ?? 'everyone';

      const isBlockedPair = blockedWith.has(otherUser._id.toString());
      const lastSeenAt = isBlockedPair || otherUser.deletedAt
        ? null
        : lastSeenVisibility === 'everyone'
          ? otherUser.lastSeenAt
          : lastSeenVisibility === 'friends'
            ? friendsTierResolved.get(chatIdStr) ?? null
            : null; // 'nobody'

      otherParticipant = {
        id: otherUser._id,
        username: otherUser.username,
        displayName: otherUser.displayName,
        avatarUrl: otherUser.avatarUrl,
        // Symmetric — visible only if BOTH sides have receipts enabled,
        // same rule WhatsApp uses to prevent one-sided snooping.
        lastReadMessageId:
          myReadReceiptsEnabled && theirReadReceiptsEnabled && !isBlockedPair
            ? otherUser.lastReadMessageId
            : null,
        lastSeenAt,
        // Deleted accounts stay as anonymised participants; the client
        // uses this to disable sending.
        deleted: Boolean(otherUser.deletedAt),
      };
    }

    return {
      ...chat.toObject(),
      membership: {
        role: membership.role,
        lastReadMessageId: membership.lastReadMessageId,
        mutedUntil: membership.mutedUntil,
        archivedAt: membership.archivedAt,
        pinnedAt: membership.pinnedAt,
      },
      otherParticipant,
      lastMessageSenderName,
      unreadCount: unreadByChat.get(chatIdStr) ?? 0,
    };
  });
}

export async function getChat(userId, chatId) {
  await assertMembership(chatId, userId);
  const chat = await Chat.findById(chatId);
  if (!chat) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Chat not found', 404);
  }
  return chat;
}

export async function listMembers(userId, chatId) {
  await assertMembership(chatId, userId);
  return ChatMember.find({ chatId, leftAt: null })
    .populate('userId', 'username displayName avatarUrl')
    .sort({ joinedAt: 1 });
}

/**
 * Tells the OTHER members, live, that userId has read up to a message so
 * their ticks turn blue. Honours the same symmetric privacy rule as the
 * chat list (receipts shown only if BOTH sides have them enabled): a
 * room-wide broadcast would leak reads from people who turned receipts
 * off, so this emits per recipient instead.
 */
async function broadcastRead(userId, chatId, lastReadMessageId) {
  const readerSettings = await UserSettings.findOne({ userId });
  if (readerSettings?.privacy?.readReceiptsEnabled === false) return;

  const others = await ChatMember.find({ chatId, leftAt: null, userId: { $ne: userId } }).select('userId');
  const otherIds = others.map((m) => m.userId.toString());
  if (!otherIds.length) return;

  const settings = await UserSettings.find({ userId: { $in: otherIds } });
  const optedOut = new Set(
    settings.filter((s) => s.privacy?.readReceiptsEnabled === false).map((s) => s.userId.toString())
  );
  // Never tell someone they've been read by a person they're blocked with.
  const blocks = await Block.find({
    $or: [
      { blockerId: userId, blockedId: { $in: otherIds } },
      { blockedId: userId, blockerId: { $in: otherIds } },
    ],
  });
  blocks.forEach((b) =>
    optedOut.add((b.blockerId.toString() === userId ? b.blockedId : b.blockerId).toString())
  );

  const io = getIO();
  otherIds
    .filter((id) => !optedOut.has(id))
    .forEach((id) => io.to(`user:${id}`).emit('message:read', { chatId, userId, lastReadMessageId }));
}

export async function markRead(userId, chatId, lastReadMessageId) {
  const member = await assertMembership(chatId, userId);

  // Verify the message actually belongs to this chat before trusting
  // a client-supplied id — cheap check, closes an easy spoof.
  const message = await Message.findOne({ _id: lastReadMessageId, chatId });
  if (!message) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Message does not belong to this chat', 400);
  }

  // Read position only moves forward — a late or repeated request for an
  // older message must not regress it (or re-notify anyone).
  const current = member.lastReadMessageId?.toString();
  if (current && current >= lastReadMessageId.toString()) return member;

  member.lastReadMessageId = lastReadMessageId;
  await member.save();

  await broadcastRead(userId, chatId, lastReadMessageId);

  return member;
}

const INDEFINITE_MUTE_DATE = new Date('9999-12-31');

export async function muteChat(userId, chatId, until) {
  const member = await assertMembership(chatId, userId);
  member.mutedUntil = until ? new Date(until) : INDEFINITE_MUTE_DATE;
  await member.save();
  return member;
}

export async function unmuteChat(userId, chatId) {
  const member = await assertMembership(chatId, userId);
  member.mutedUntil = null;
  await member.save();
  return member;
}

export async function archiveChat(userId, chatId) {
  const member = await assertMembership(chatId, userId);
  member.archivedAt = new Date();
  await member.save();
  return member;
}

export async function unarchiveChat(userId, chatId) {
  const member = await assertMembership(chatId, userId);
  member.archivedAt = null;
  await member.save();
  return member;
}

export async function pinChat(userId, chatId) {
  const member = await assertMembership(chatId, userId);
  member.pinnedAt = new Date();
  await member.save();
  return member;
}

export async function unpinChat(userId, chatId) {
  const member = await assertMembership(chatId, userId);
  member.pinnedAt = null;
  await member.save();
  return member;
}

/**
 * "Clear chat for me" — sets a per-viewer timestamp, not a data
 * deletion. Messages/systems messages before this point are hidden
 * from this member's own message list query; the other participant(s)
 * and the underlying Message documents are completely unaffected.
 */
export async function clearChat(userId, chatId) {
  const member = await assertMembership(chatId, userId);
  member.clearedBefore = new Date();
  await member.save();
  return member;
}
