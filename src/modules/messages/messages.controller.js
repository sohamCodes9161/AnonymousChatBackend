import mongoose from 'mongoose';
import * as messagesService from './messages.service.js';
import { AppError, ErrorCodes } from '../../utils/AppError.js';

export async function sendMessage(req, res, next) {
  try {
    const message = await messagesService.sendMessage(req.user.id, req.params.chatId, req.body);
    res.status(201).json({ success: true, data: { message: message.toPublicJSON() } });
  } catch (err) {
    next(err);
  }
}

export async function listMessages(req, res, next) {
  try {
    const { before, limit } = req.query;

    if (before && !mongoose.Types.ObjectId.isValid(before)) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid "before" cursor', 400);
    }

    const result = await messagesService.listMessages(req.user.id, req.params.chatId, {
      before: before || undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });

    res.json({
      success: true,
      data: { messages: result.messages.map((m) => m.toPublicJSON()) },
      pagination: { nextCursor: result.nextCursor, hasMore: result.hasMore },
    });
  } catch (err) {
    next(err);
  }
}

export async function editMessage(req, res, next) {
  try {
    const message = await messagesService.editMessage(req.user.id, req.params.messageId, req.body.content);
    res.json({ success: true, data: { message: message.toPublicJSON() } });
  } catch (err) {
    next(err);
  }
}

export async function deleteMessage(req, res, next) {
  try {
    const message = await messagesService.deleteMessage(req.user.id, req.params.messageId);
    res.json({ success: true, data: { message: message.toPublicJSON() } });
  } catch (err) {
    next(err);
  }
}
