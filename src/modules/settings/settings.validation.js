import { z } from 'zod';

export const updateSettingsSchema = z.object({
  themePreference: z.enum(['light', 'dark', 'system']).optional(),
  notificationPreferences: z
    .object({
      friendRequests: z.boolean().optional(),
      friendAccepted: z.boolean().optional(),
      groupEvents: z.boolean().optional(),
    })
    .optional(),
  privacy: z
    .object({
      lastSeenVisibility: z.enum(['everyone', 'friends', 'nobody']).optional(),
      readReceiptsEnabled: z.boolean().optional(),
    })
    .optional(),
});
