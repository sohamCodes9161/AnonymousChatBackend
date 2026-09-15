import mongoose from 'mongoose';

const friendshipSchema = new mongoose.Schema(
  {
    // Always stored in sorted order (utils/pair.js) — prevents duplicate
    // rows representing the same pair in either direction.
    userAId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    userBId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  },
  { timestamps: true }
);

friendshipSchema.index({ userAId: 1, userBId: 1 }, { unique: true });

export const Friendship = mongoose.model('Friendship', friendshipSchema);
