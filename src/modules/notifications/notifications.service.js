import { Notification } from './notification.model.js';
import { AppError, ErrorCodes } from '../../utils/AppError.js';

export async function listNotifications(userId, { before, limit = 30 } = {}) {
  const query = { userId };
  if (before) {
    query._id = { $lt: before };
  }

  const cappedLimit = Math.min(limit, 100);
  const rows = await Notification.find(query).sort({ _id: -1 }).limit(cappedLimit + 1);

  const hasMore = rows.length > cappedLimit;
  const page = hasMore ? rows.slice(0, cappedLimit) : rows;
  const nextCursor = hasMore ? page[page.length - 1]._id : null;

  return { notifications: page, nextCursor, hasMore };
}

export async function markRead(userId, notificationId) {
  const notification = await Notification.findOne({ _id: notificationId, userId });
  if (!notification) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Notification not found', 404);
  }
  notification.readAt = new Date();
  await notification.save();
  return notification;
}

export async function markAllRead(userId) {
  await Notification.updateMany({ userId, readAt: null }, { readAt: new Date() });
}

export async function getUnreadCount(userId) {
  return Notification.countDocuments({ userId, readAt: null });
}
