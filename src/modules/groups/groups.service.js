import { Chat } from '../chats/chat.model.js';
import { ChatMember } from '../chats/chatMember.model.js';
import * as chatsService from '../chats/chats.service.js';
import { createSystemMessage } from '../messages/systemMessage.js';
import { domainEventBus } from '../../events/domainEventBus.js';
import { AppError, ErrorCodes } from '../../utils/AppError.js';

async function getGroupChat(chatId) {
  const chat = await Chat.findById(chatId);
  if (!chat || chat.type !== 'group' || chat.deletedAt) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Group chat not found', 404);
  }
  return chat;
}

async function requireRole(chatId, userId, allowedRoles) {
  const member = await chatsService.assertMembership(chatId, userId);
  if (!allowedRoles.includes(member.role)) {
    throw new AppError(ErrorCodes.AUTH_UNAUTHORIZED, 'Insufficient permissions for this action', 403);
  }
  return member;
}

export async function removeMember(currentUserId, chatId, targetUserId) {
  await getGroupChat(chatId);
  await requireRole(chatId, currentUserId, ['admin', 'owner']);

  const target = await ChatMember.findOne({ chatId, userId: targetUserId, leftAt: null });
  if (!target) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Member not found', 404);
  }
  if (target.role === 'owner') {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'Cannot remove the owner — they must leave voluntarily',
      400
    );
  }

  target.leftAt = new Date();
  await target.save();
  await createSystemMessage(chatId, 'member_removed', { userId: targetUserId });
  return target;
}

export async function promoteToAdmin(currentUserId, chatId, targetUserId) {
  await getGroupChat(chatId);
  await requireRole(chatId, currentUserId, ['owner']);

  const target = await ChatMember.findOne({ chatId, userId: targetUserId, leftAt: null });
  if (!target) throw new AppError(ErrorCodes.NOT_FOUND, 'Member not found', 404);
  if (target.role !== 'member') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'User is already admin or owner', 409);
  }

  target.role = 'admin';
  await target.save();
  await createSystemMessage(chatId, 'role_changed', { userId: targetUserId, role: 'admin' });
  domainEventBus.emit('group.role.changed', {
    chatId,
    userId: targetUserId,
    role: 'admin',
    changedBy: currentUserId,
  });
  return target;
}

export async function demoteAdmin(currentUserId, chatId, targetUserId) {
  await getGroupChat(chatId);
  await requireRole(chatId, currentUserId, ['owner']);

  const target = await ChatMember.findOne({ chatId, userId: targetUserId, leftAt: null });
  if (!target) throw new AppError(ErrorCodes.NOT_FOUND, 'Member not found', 404);
  if (target.role !== 'admin') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'User is not an admin', 400);
  }

  target.role = 'member';
  await target.save();
  await createSystemMessage(chatId, 'role_changed', { userId: targetUserId, role: 'member' });
  domainEventBus.emit('group.role.changed', {
    chatId,
    userId: targetUserId,
    role: 'member',
    changedBy: currentUserId,
  });
  return target;
}

export async function updateGroupInfo(currentUserId, chatId, updates) {
  await getGroupChat(chatId);
  await requireRole(chatId, currentUserId, ['admin', 'owner']);

  const chat = await Chat.findByIdAndUpdate(chatId, updates, { new: true, runValidators: true });
  await createSystemMessage(chatId, 'group_info_updated', { updatedFields: Object.keys(updates) });
  return chat;
}

export async function deleteGroup(currentUserId, chatId) {
  await getGroupChat(chatId);
  await requireRole(chatId, currentUserId, ['owner']);

  const chat = await Chat.findById(chatId);
  chat.deletedAt = new Date();
  await chat.save();

  // Soft-delete cascades to membership — every member loses access
  // immediately, not just eventually via some other check.
  await ChatMember.updateMany({ chatId, leftAt: null }, { leftAt: new Date() });

  return chat;
}

export async function leaveGroup(currentUserId, chatId) {
  await getGroupChat(chatId);
  const member = await chatsService.assertMembership(chatId, currentUserId);

  member.leftAt = new Date();
  await member.save();
  await createSystemMessage(chatId, 'member_left', { userId: currentUserId });

  if (member.role === 'owner') {
    await handleOwnerSuccession(chatId);
  }

  return member;
}

async function handleOwnerSuccession(chatId) {
  // Deterministic tiebreaker: longest-standing admin first, no vote or
  // consent flow needed — the system already knows who's next.
  const nextAdmin = await ChatMember.findOne({ chatId, role: 'admin', leftAt: null }).sort({
    joinedAt: 1,
  });
  if (nextAdmin) {
    nextAdmin.role = 'owner';
    await nextAdmin.save();
    await createSystemMessage(chatId, 'owner_changed', { userId: nextAdmin.userId });
    return;
  }

  const nextMember = await ChatMember.findOne({ chatId, role: 'member', leftAt: null }).sort({
    joinedAt: 1,
  });
  if (nextMember) {
    nextMember.role = 'owner';
    await nextMember.save();
    await createSystemMessage(chatId, 'owner_changed', { userId: nextMember.userId });
    return;
  }

  // No one left — mark the group inactive rather than hard-deleting;
  // a real purge can run later via a cleanup job, not synchronously here.
  await Chat.findByIdAndUpdate(chatId, { deletedAt: new Date() });
}
