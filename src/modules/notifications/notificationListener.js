import { domainEventBus } from '../../events/domainEventBus.js';
import { Notification } from './notification.model.js';

/**
 * Persists a subset of domain events as Notification rows. Only
 * relationship/group events get persisted here — new messages don't;
 * those are covered by ChatMember.lastReadMessageId (Chat System),
 * per the Notification System design's explicit scoping decision.
 */
export function registerNotificationListener() {
  domainEventBus.on('friend.request.received', async ({ toUserId, fromUserId, requestId }) => {
    await Notification.create({
      userId: toUserId,
      type: 'friend_request_received',
      payload: { requestId, fromUserId },
    });
  });

  domainEventBus.on('friend.request.accepted', async ({ toUserId, byUserId, friendshipId }) => {
    await Notification.create({
      userId: toUserId,
      type: 'friend_request_accepted',
      payload: { friendshipId, byUserId },
    });
  });

  domainEventBus.on('group.member.added', async ({ chatId, userId, addedBy }) => {
    await Notification.create({
      userId,
      type: 'group_member_added',
      payload: { chatId, addedBy },
    });
  });

  domainEventBus.on('group.role.changed', async ({ chatId, userId, role, changedBy }) => {
    await Notification.create({
      userId,
      type: 'group_role_changed',
      payload: { chatId, role, changedBy },
    });
  });
}
