import mongoose from 'mongoose';

const blockSchema = new mongoose.Schema(
  {
    blockerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    blockedId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

blockSchema.index({ blockerId: 1, blockedId: 1 }, { unique: true });
// Supports the reverse-direction check ("has this person blocked me")
// in the relationship resolver without a full collection scan.
blockSchema.index({ blockedId: 1 });

export const Block = mongoose.model('Block', blockSchema);
