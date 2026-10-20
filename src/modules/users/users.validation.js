import { z } from 'zod';

export const deleteAccountSchema = z.object({
  password: z.string().min(1).max(200),
});

export const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(50).optional(),
  bio: z.string().max(200).optional(),
});
