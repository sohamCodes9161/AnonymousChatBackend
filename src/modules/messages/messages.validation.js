import { z } from 'zod';
import mongoose from 'mongoose';
import { isAllowedGiphyUrl } from '../../utils/giphy.js';

const objectId = z.string().refine((v) => mongoose.Types.ObjectId.isValid(v), { message: 'Invalid id' });

const giphyUrl = z.string().refine(isAllowedGiphyUrl, { message: 'GIF links must be https URLs on giphy.com' });
const gifDimension = z.number().int().min(1).max(4000);

const messageBase = {
  clientMessageId: z.string().optional(),
  replyToMessageId: objectId.optional(),
};

const textMessageSchema = z.object({
  type: z.literal('text'),
  content: z.object({ text: z.string().min(1).max(5000) }),
  ...messageBase,
});

// GIFs are links to GIPHY's CDN, never uploads. The hostname allowlist
// is enforced here AND again in the service (defence in depth).
const gifMessageSchema = z.object({
  type: z.literal('gif'),
  content: z.object({
    gifUrl: giphyUrl,
    previewUrl: giphyUrl,
    width: gifDimension,
    height: gifDimension,
    title: z.string().max(200).optional(),
  }),
  ...messageBase,
});

// `type` was optional (default 'text') before GIFs existed — keep old
// clients working by filling it in before the union picks a branch.
export const sendMessageSchema = z.preprocess(
  (body) => (body && typeof body === 'object' && body.type === undefined ? { ...body, type: 'text' } : body),
  z.discriminatedUnion('type', [textMessageSchema, gifMessageSchema])
);

export const editMessageSchema = z.object({
  content: z.object({ text: z.string().min(1).max(5000) }),
});

export const reactionSchema = z.object({
  emoji: z.string().min(1).max(8),
});
