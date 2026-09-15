import { z } from 'zod';
import mongoose from 'mongoose';

const objectId = z.string().refine((v) => mongoose.Types.ObjectId.isValid(v), { message: 'Invalid id' });

export const createDirectChatSchema = z.object({ userId: objectId });

export const createGroupChatSchema = z.object({
  name: z.string().min(1).max(100),
  memberIds: z.array(objectId).default([]),
});

export const addMemberSchema = z.object({ userId: objectId });

export const markReadSchema = z.object({ lastReadMessageId: objectId });

export const muteSchema = z.object({
  until: z.string().datetime().nullable().optional(),
});
