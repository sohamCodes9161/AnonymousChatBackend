import mongoose from 'mongoose';

const chatMemberSchema = new mongoose.Schema(
  {
    chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['member', 'admin', 'owner'], default: 'member' },
    joinedAt: { type: Date, default: Date.now },
    // Soft delete — kept, not removed, so "X left the group" system
    // messages stay coherent and a rejoined member sees full history
    // (messages belong to the Chat, not to who happened to be present).
    leftAt: { type: Date, default: null },
    mutedUntil: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
    lastReadMessageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
  },
  { timestamps: true }
);

// The single most-repeated query in the app — every message send and
// every chat action checks this pair.
chatMemberSchema.index({ chatId: 1, userId: 1 }, { unique: true });
chatMemberSchema.index({ userId: 1, leftAt: 1 });

export const ChatMember = mongoose.model('ChatMember', chatMemberSchema);
