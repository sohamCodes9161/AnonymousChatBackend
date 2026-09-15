import * as chatsService from './chats.service.js';

export async function createDirectChat(req, res, next) {
  try {
    const chat = await chatsService.getOrCreateDirectChat(req.user.id, req.body.userId);
    res.status(201).json({ success: true, data: { chat } });
  } catch (err) {
    next(err);
  }
}

export async function createGroupChat(req, res, next) {
  try {
    const chat = await chatsService.createGroupChat(req.user.id, req.body);
    res.status(201).json({ success: true, data: { chat } });
  } catch (err) {
    next(err);
  }
}

export async function addMember(req, res, next) {
  try {
    const member = await chatsService.addGroupMember(req.user.id, req.params.chatId, req.body.userId);
    res.status(201).json({ success: true, data: { member } });
  } catch (err) {
    next(err);
  }
}

export async function listMyChats(req, res, next) {
  try {
    const chats = await chatsService.listMyChats(req.user.id);
    res.json({ success: true, data: { chats } });
  } catch (err) {
    next(err);
  }
}

export async function getChat(req, res, next) {
  try {
    const chat = await chatsService.getChat(req.user.id, req.params.chatId);
    res.json({ success: true, data: { chat } });
  } catch (err) {
    next(err);
  }
}

export async function listMembers(req, res, next) {
  try {
    const members = await chatsService.listMembers(req.user.id, req.params.chatId);
    res.json({ success: true, data: { members } });
  } catch (err) {
    next(err);
  }
}

export async function markRead(req, res, next) {
  try {
    const member = await chatsService.markRead(req.user.id, req.params.chatId, req.body.lastReadMessageId);
    res.json({ success: true, data: { member } });
  } catch (err) {
    next(err);
  }
}

export async function muteChat(req, res, next) {
  try {
    const member = await chatsService.muteChat(req.user.id, req.params.chatId, req.body.until);
    res.json({ success: true, data: { member } });
  } catch (err) {
    next(err);
  }
}

export async function unmuteChat(req, res, next) {
  try {
    const member = await chatsService.unmuteChat(req.user.id, req.params.chatId);
    res.json({ success: true, data: { member } });
  } catch (err) {
    next(err);
  }
}

export async function archiveChat(req, res, next) {
  try {
    const member = await chatsService.archiveChat(req.user.id, req.params.chatId);
    res.json({ success: true, data: { member } });
  } catch (err) {
    next(err);
  }
}

export async function unarchiveChat(req, res, next) {
  try {
    const member = await chatsService.unarchiveChat(req.user.id, req.params.chatId);
    res.json({ success: true, data: { member } });
  } catch (err) {
    next(err);
  }
}
