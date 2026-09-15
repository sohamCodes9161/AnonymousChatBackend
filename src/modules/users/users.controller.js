import * as usersService from './users.service.js';
import { AppError, ErrorCodes } from '../../utils/AppError.js';

export async function getProfile(req, res, next) {
  try {
    const user = await usersService.getProfile(req.params.userId);
    res.json({ success: true, data: { user: user.toPublicJSON() } });
  } catch (err) {
    next(err);
  }
}

export async function updateProfile(req, res, next) {
  try {
    const user = await usersService.updateProfile(req.user.id, req.body);
    res.json({ success: true, data: { user: user.toPublicJSON() } });
  } catch (err) {
    next(err);
  }
}

export async function uploadAvatar(req, res, next) {
  try {
    if (!req.file) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'No file uploaded — send it as form-data with field name "avatar"',
        400
      );
    }
    const user = await usersService.uploadAvatar(req.user.id, req.file.buffer);
    res.json({ success: true, data: { user: user.toPublicJSON() } });
  } catch (err) {
    next(err);
  }
}

export async function search(req, res, next) {
  try {
    const results = await usersService.searchUsers(req.user.id, req.query.q);
    res.json({ success: true, data: { results } });
  } catch (err) {
    next(err);
  }
}
