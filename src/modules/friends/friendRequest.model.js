import mongoose from 'mongoose';

const friendRequestSchema = new mongoose.Schema(
  {
    fromUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    toUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected', 'cancelled'],
      default: 'pending',
    },
    respondedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Prevents duplicate pending requests in the same direction — a second
// send attempt hits this constraint instead of creating a duplicate row.
friendRequestSchema.index(
  { fromUserId: 1, toUserId: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } }
);

friendRequestSchema.index({ toUserId: 1, status: 1 });
friendRequestSchema.index({ fromUserId: 1, status: 1 });

export const FriendRequest = mongoose.model('FriendRequest', friendRequestSchema);
