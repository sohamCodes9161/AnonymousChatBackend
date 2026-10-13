import mongoose from 'mongoose';

const messageReactionSchema = new mongoose.Schema(
  {
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    emoji: { type: String, required: true, maxlength: 8 },
  },
  { timestamps: true }
);

// One of each emoji per user per message — clicking the same emoji
// again is a toggle-off, not a duplicate.
messageReactionSchema.index({ messageId: 1, userId: 1, emoji: 1 }, { unique: true });
// Batch-fetching reactions for a whole page of messages at once.
messageReactionSchema.index({ messageId: 1 });

export const MessageReaction = mongoose.model('MessageReaction', messageReactionSchema);
