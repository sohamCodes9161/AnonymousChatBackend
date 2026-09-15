import { domainEventBus } from '../events/domainEventBus.js';
import { getIO } from './ioInstance.js';

/**
 * Forwards the same domain events to whichever socket(s) the recipient
 * currently has open, via their personal room. Lives in sockets/ since
 * it's Real-Time's job to deliver live — but it only KNOWS about these
 * events because it subscribed to the bus, not because Friend/Group
 * called it directly.
 */
export function registerRealtimeNotificationBridge() {
  domainEventBus.on('friend.request.received', ({ toUserId, fromUserId, requestId }) => {
    getIO().to(`user:${toUserId}`).emit('friend:request_received', { requestId, fromUserId });
  });

  domainEventBus.on('friend.request.accepted', ({ toUserId, byUserId, friendshipId }) => {
    getIO().to(`user:${toUserId}`).emit('friend:request_accepted', { byUserId, friendshipId });
  });

  domainEventBus.on('group.member.added', ({ chatId, userId, addedBy }) => {
    getIO().to(`user:${userId}`).emit('group:member_added', { chatId, addedBy });
  });

  domainEventBus.on('group.role.changed', ({ chatId, userId, role, changedBy }) => {
    getIO().to(`user:${userId}`).emit('group:role_changed', { chatId, role, changedBy });
  });
}
