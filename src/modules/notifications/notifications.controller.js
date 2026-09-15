import * as notificationsService from './notifications.service.js';

export async function list(req, res, next) {
  try {
    const { before, limit } = req.query;
    const result = await notificationsService.listNotifications(req.user.id, {
      before: before || undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    res.json({
      success: true,
      data: { notifications: result.notifications.map((n) => n.toPublicJSON()) },
      pagination: { nextCursor: result.nextCursor, hasMore: result.hasMore },
    });
  } catch (err) {
    next(err);
  }
}

export async function markRead(req, res, next) {
  try {
    const notification = await notificationsService.markRead(req.user.id, req.params.notificationId);
    res.json({ success: true, data: { notification: notification.toPublicJSON() } });
  } catch (err) {
    next(err);
  }
}

export async function markAllRead(req, res, next) {
  try {
    await notificationsService.markAllRead(req.user.id);
    res.json({ success: true, data: { markedAllRead: true } });
  } catch (err) {
    next(err);
  }
}

export async function unreadCount(req, res, next) {
  try {
    const count = await notificationsService.getUnreadCount(req.user.id);
    res.json({ success: true, data: { count } });
  } catch (err) {
    next(err);
  }
}
