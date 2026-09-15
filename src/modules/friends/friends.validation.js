import { z } from 'zod';
import mongoose from 'mongoose';

const objectId = z
  .string()
  .refine((val) => mongoose.Types.ObjectId.isValid(val), { message: 'Invalid user id' });

export const sendRequestSchema = z.object({
  toUserId: objectId,
});
