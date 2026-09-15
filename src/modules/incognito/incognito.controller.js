import * as incognitoService from './incognito.service.js';

export async function start(req, res, next) {
  try {
    const session = await incognitoService.startSession(req.user.id, req.params.chatId);
    res.status(201).json({ success: true, data: { session } });
  } catch (err) {
    next(err);
  }
}

export async function end(req, res, next) {
  try {
    await incognitoService.endSession(req.user.id, req.params.chatId);
    res.json({ success: true, data: { ended: true } });
  } catch (err) {
    next(err);
  }
}

export async function getStatus(req, res, next) {
  try {
    const session = await incognitoService.getActiveSession(req.user.id, req.params.chatId);
    res.json({ success: true, data: { session } });
  } catch (err) {
    next(err);
  }
}
