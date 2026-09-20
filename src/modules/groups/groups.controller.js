import * as groupsService from './groups.service.js';
import { AppError, ErrorCodes } from '../../utils/AppError.js';

export async function removeMember(req, res, next) {
  try {
    await groupsService.removeMember(req.user.id, req.params.chatId, req.params.userId);
    res.json({ success: true, data: { removed: true } });
  } catch (err) {
    next(err);
  }
}

export async function promoteToAdmin(req, res, next) {
  try {
    const member = await groupsService.promoteToAdmin(req.user.id, req.params.chatId, req.params.userId);
    res.json({ success: true, data: { member } });
  } catch (err) {
    next(err);
  }
}

export async function demoteAdmin(req, res, next) {
  try {
    const member = await groupsService.demoteAdmin(req.user.id, req.params.chatId, req.params.userId);
    res.json({ success: true, data: { member } });
  } catch (err) {
    next(err);
  }
}

export async function updateGroupInfo(req, res, next) {
  try {
    const chat = await groupsService.updateGroupInfo(req.user.id, req.params.chatId, req.body);
    res.json({ success: true, data: { chat } });
  } catch (err) {
    next(err);
  }
}

export async function deleteGroup(req, res, next) {
  try {
    await groupsService.deleteGroup(req.user.id, req.params.chatId);
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
}

export async function leaveGroup(req, res, next) {
  try {
    await groupsService.leaveGroup(req.user.id, req.params.chatId);
    res.json({ success: true, data: { left: true } });
  } catch (err) {
    next(err);
  }
}

export async function uploadGroupAvatar(req, res, next) {
  try {
    if (!req.file) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'No file uploaded — send it as form-data with field name "avatar"',
        400
      );
    }
    const chat = await groupsService.updateGroupAvatar(req.user.id, req.params.chatId, req.file.buffer);
    res.json({ success: true, data: { chat } });
  } catch (err) {
    next(err);
  }
}
