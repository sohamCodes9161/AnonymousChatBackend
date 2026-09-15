import mongoose from 'mongoose';
import { FriendRequest } from './friendRequest.model.js';
import { Friendship } from './friendship.model.js';
import { Block } from './block.model.js';
import { User } from '../users/user.model.js';
import { Chat } from '../chats/chat.model.js';
import { sortPair } from '../../utils/pair.js';
import { domainEventBus } from '../../events/domainEventBus.js';
import { getIO } from '../../sockets/ioInstance.js';
import { AppError, ErrorCodes } from '../../utils/AppError.js';

async function getBlockBetween(userIdA, userIdB) {
  return Block.findOne({
    $or: [
      { blockerId: userIdA, blockedId: userIdB },
      { blockerId: userIdB, blockedId: userIdA },
    ],
  });
}

/**
 * The relationship resolver — never a stored boolean. Checked in strict
 * precedence: block, then friendship, then pending request. A block
 * short-circuits everything beneath it.
 */
export async function getRelationshipStatus(currentUserId, otherUserId) {
  if (currentUserId === otherUserId) {
    return { status: 'self' };
  }

  const block = await getBlockBetween(currentUserId, otherUserId);
  if (block) {
    return {
      status: block.blockerId.toString() === currentUserId ? 'blocked_by_me' : 'blocked_by_them',
    };
  }

  const [a, b] = sortPair(currentUserId, otherUserId);
  const friendship = await Friendship.findOne({ userAId: a, userBId: b });
  if (friendship) {
    return { status: 'friends', friendshipId: friendship._id };
  }

  const outgoing = await FriendRequest.findOne({
    fromUserId: currentUserId,
    toUserId: otherUserId,
    status: 'pending',
  });
  if (outgoing) return { status: 'outgoing_request', requestId: outgoing._id };

  const incoming = await FriendRequest.findOne({
    fromUserId: otherUserId,
    toUserId: currentUserId,
    status: 'pending',
  });
  if (incoming) return { status: 'incoming_request', requestId: incoming._id };

  return { status: 'none' };
}

export async function sendRequest(fromUserId, toUserId) {
  if (fromUserId === toUserId) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Cannot send a friend request to yourself', 400);
  }

  const toUser = await User.findById(toUserId);
  if (!toUser) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'User not found', 404);
  }

  const block = await getBlockBetween(fromUserId, toUserId);
  if (block) {
    // Same "not found" as a nonexistent user — never reveal a block
    // exists in either direction (Friend System design).
    throw new AppError(ErrorCodes.NOT_FOUND, 'User not found', 404);
  }

  const [a, b] = sortPair(fromUserId, toUserId);
  const existingFriendship = await Friendship.findOne({ userAId: a, userBId: b });
  if (existingFriendship) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Already friends', 409);
  }

  // Simultaneous-request auto-resolve: if the other person already sent
  // a pending request the other way, accept it instead of creating a
  // second pending row that would just sit there awkwardly.
  const reverseRequest = await FriendRequest.findOne({
    fromUserId: toUserId,
    toUserId: fromUserId,
    status: 'pending',
  });
  if (reverseRequest) {
    return acceptRequest(fromUserId, reverseRequest._id.toString());
  }

  try {
    const request = await FriendRequest.create({ fromUserId, toUserId, status: 'pending' });
    domainEventBus.emit('friend.request.received', {
      toUserId,
      fromUserId,
      requestId: request._id.toString(),
    });
    return request;
  } catch (err) {
    if (err.code === 11000) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Friend request already pending', 409);
    }
    throw err;
  }
}

export async function acceptRequest(currentUserId, requestId) {
  const session = await mongoose.startSession();
  let originalSenderId;
  try {
    let friendship;
    await session.withTransaction(async () => {
      const request = await FriendRequest.findById(requestId).session(session);
      if (!request || request.status !== 'pending') {
        throw new AppError(ErrorCodes.NOT_FOUND, 'Friend request not found', 404);
      }
      if (request.toUserId.toString() !== currentUserId) {
        throw new AppError(ErrorCodes.AUTH_UNAUTHORIZED, 'Not authorized to accept this request', 403);
      }

      request.status = 'accepted';
      request.respondedAt = new Date();
      await request.save({ session });
      originalSenderId = request.fromUserId.toString();

      const [a, b] = sortPair(request.fromUserId.toString(), request.toUserId.toString());
      const created = await Friendship.create([{ userAId: a, userBId: b }], {
        session,
        ordered: true,
      });
      friendship = created[0];
    });

    // Notify the ORIGINAL sender — they're the one who'll want to know
    // their request was accepted, not the acceptor.
    domainEventBus.emit('friend.request.accepted', {
      toUserId: originalSenderId,
      byUserId: currentUserId,
      friendshipId: friendship._id.toString(),
    });

    return friendship;
  } finally {
    session.endSession();
  }
}

export async function rejectRequest(currentUserId, requestId) {
  const request = await FriendRequest.findById(requestId);
  if (!request || request.status !== 'pending') {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Friend request not found', 404);
  }
  if (request.toUserId.toString() !== currentUserId) {
    throw new AppError(ErrorCodes.AUTH_UNAUTHORIZED, 'Not authorized to reject this request', 403);
  }
  request.status = 'rejected';
  request.respondedAt = new Date();
  await request.save();
  // Deliberately no event/notification to the sender — per Friend
  // System design, rejection is silent.
  return request;
}

export async function cancelRequest(currentUserId, requestId) {
  const request = await FriendRequest.findById(requestId);
  if (!request || request.status !== 'pending') {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Friend request not found', 404);
  }
  if (request.fromUserId.toString() !== currentUserId) {
    throw new AppError(ErrorCodes.AUTH_UNAUTHORIZED, 'Not authorized to cancel this request', 403);
  }
  request.status = 'cancelled';
  request.respondedAt = new Date();
  await request.save();
  return request;
}

export async function removeFriend(currentUserId, otherUserId) {
  const [a, b] = sortPair(currentUserId, otherUserId);
  const result = await Friendship.findOneAndDelete({ userAId: a, userBId: b });
  if (!result) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Friendship not found', 404);
  }
  return result;
}

export async function blockUser(currentUserId, targetUserId) {
  if (currentUserId === targetUserId) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Cannot block yourself', 400);
  }

  const targetUser = await User.findById(targetUserId);
  if (!targetUser) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'User not found', 404);
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // Cancel any pending request between the two, either direction.
      await FriendRequest.updateMany(
        {
          status: 'pending',
          $or: [
            { fromUserId: currentUserId, toUserId: targetUserId },
            { fromUserId: targetUserId, toUserId: currentUserId },
          ],
        },
        { status: 'cancelled', respondedAt: new Date() },
        { session }
      );

      // Remove any existing friendship.
      const [a, b] = sortPair(currentUserId, targetUserId);
      await Friendship.deleteOne({ userAId: a, userBId: b }, { session });

      // Insert the block — upsert so calling this twice is a harmless no-op.
      await Block.updateOne(
        { blockerId: currentUserId, blockedId: targetUserId },
        { $setOnInsert: { blockerId: currentUserId, blockedId: targetUserId } },
        { upsert: true, session }
      );
    });
  } finally {
    session.endSession();
  }

  // Blocking never touches ChatMember, so if a direct chat already
  // exists between these two, both sockets are still sitting in its
  // room — meaning typing indicators (and any other room-broadcast
  // event) would still leak between a blocked pair, even though
  // message sending is already rejected at the data layer. Force both
  // out of that room specifically.
  const [a, b] = sortPair(currentUserId, targetUserId);
  const directChat = await Chat.findOne({ type: 'direct', directPairKey: `${a}_${b}` });
  if (directChat) {
    const chatId = directChat._id.toString();
    getIO().in(`user:${currentUserId}`).socketsLeave(chatId);
    getIO().in(`user:${targetUserId}`).socketsLeave(chatId);
  }
}

export async function unblockUser(currentUserId, targetUserId) {
  const result = await Block.findOneAndDelete({
    blockerId: currentUserId,
    blockedId: targetUserId,
  });
  if (!result) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Block not found', 404);
  }
  // Resets to "no relationship" — deliberately does not restore any
  // prior friendship (Friend System design).
}

export async function listFriends(currentUserId) {
  const friendships = await Friendship.find({
    $or: [{ userAId: currentUserId }, { userBId: currentUserId }],
  }).sort({ createdAt: -1 });

  const friendIds = friendships.map((f) =>
    f.userAId.toString() === currentUserId ? f.userBId : f.userAId
  );

  return User.find({ _id: { $in: friendIds } });
}

export async function listIncomingRequests(currentUserId) {
  return FriendRequest.find({ toUserId: currentUserId, status: 'pending' })
    .populate('fromUserId', 'username displayName avatarUrl')
    .sort({ createdAt: -1 });
}

export async function listOutgoingRequests(currentUserId) {
  return FriendRequest.find({ fromUserId: currentUserId, status: 'pending' })
    .populate('toUserId', 'username displayName avatarUrl')
    .sort({ createdAt: -1 });
}

export async function listBlockedUsers(currentUserId) {
  const blocks = await Block.find({ blockerId: currentUserId })
    .populate('blockedId', 'username displayName avatarUrl')
    .sort({ createdAt: -1 });
  return blocks.map((b) => b.blockedId);
}
