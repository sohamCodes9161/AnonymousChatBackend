import { z } from 'zod';
import mongoose from 'mongoose';

const objectId = z.string().refine((v) => mongoose.Types.ObjectId.isValid(v), { message: 'Invalid id' });

export const sendMessageSchema = z.object({
  type: z.enum(['text']).default('text'),
  content: z.object({ text: z.string().min(1).max(5000) }),
  clientMessageId: z.string().optional(),
  replyToMessageId: objectId.optional(),
});

export const editMessageSchema = z.object({
  content: z.object({ text: z.string().min(1).max(5000) }),
});
