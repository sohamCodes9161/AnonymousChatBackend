import * as friendsService from './friends.service.js';

export async function getStatus(req, res, next) {
  try {
    const status = await friendsService.getRelationshipStatus(req.user.id, req.params.userId);
    res.json({ success: true, data: status });
  } catch (err) {
    next(err);
  }
}

export async function sendRequest(req, res, next) {
  try {
    const request = await friendsService.sendRequest(req.user.id, req.body.toUserId);
    res.status(201).json({ success: true, data: { request } });
  } catch (err) {
    next(err);
  }
}

export async function acceptRequest(req, res, next) {
  try {
    const friendship = await friendsService.acceptRequest(req.user.id, req.params.requestId);
    res.json({ success: true, data: { friendship } });
  } catch (err) {
    next(err);
  }
}

export async function rejectRequest(req, res, next) {
  try {
    const request = await friendsService.rejectRequest(req.user.id, req.params.requestId);
    res.json({ success: true, data: { request } });
  } catch (err) {
    next(err);
  }
}

export async function cancelRequest(req, res, next) {
  try {
    const request = await friendsService.cancelRequest(req.user.id, req.params.requestId);
    res.json({ success: true, data: { request } });
  } catch (err) {
    next(err);
  }
}

export async function removeFriend(req, res, next) {
  try {
    await friendsService.removeFriend(req.user.id, req.params.userId);
    res.json({ success: true, data: { removed: true } });
  } catch (err) {
    next(err);
  }
}

export async function blockUser(req, res, next) {
  try {
    await friendsService.blockUser(req.user.id, req.params.userId);
    res.json({ success: true, data: { blocked: true } });
  } catch (err) {
    next(err);
  }
}

export async function unblockUser(req, res, next) {
  try {
    await friendsService.unblockUser(req.user.id, req.params.userId);
    res.json({ success: true, data: { unblocked: true } });
  } catch (err) {
    next(err);
  }
}

export async function listFriends(req, res, next) {
  try {
    const users = await friendsService.listFriends(req.user.id);
    res.json({ success: true, data: { friends: users.map((u) => u.toPublicJSON()) } });
  } catch (err) {
    next(err);
  }
}

export async function listIncoming(req, res, next) {
  try {
    const requests = await friendsService.listIncomingRequests(req.user.id);
    res.json({ success: true, data: { requests } });
  } catch (err) {
    next(err);
  }
}

export async function listOutgoing(req, res, next) {
  try {
    const requests = await friendsService.listOutgoingRequests(req.user.id);
    res.json({ success: true, data: { requests } });
  } catch (err) {
    next(err);
  }
}

export async function listBlocked(req, res, next) {
  try {
    const users = await friendsService.listBlockedUsers(req.user.id);
    res.json({ success: true, data: { users } });
  } catch (err) {
    next(err);
  }
}
