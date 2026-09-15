import mongoose from 'mongoose';

const chatSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['direct', 'group'], required: true },

    // Group-only fields — null for direct chats, whose "identity" in
    // the UI is derived from the other participant's profile instead.
    name: { type: String, default: null, maxlength: 100 },
    avatarUrl: { type: String, default: null },
    description: { type: String, default: null, maxlength: 300 },

    lastActivity: { type: Date, default: Date.now },
    // Denormalized for fast chat-list rendering — avoids a join against
    // Messages just to show a preview.
    lastMessageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
    lastMessagePreview: { type: String, default: null },
    // Null for system messages (no human sender) — used to prefix the
    // sidebar preview with a name in group chats.
    lastMessageSenderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // Kept in sync by the Incognito System once it's built — lets a
    // chat-list query know the current mode without joining against
    // IncognitoSessions.
    activeIncognitoSessionId: { type: mongoose.Schema.Types.ObjectId, default: null },

    // Soft delete for group deletion — set alongside a bulk update of
    // every ChatMember's leftAt (Group System), so access is revoked
    // immediately without relying on every consumer to also check this
    // flag independently.
    deletedAt: { type: Date, default: null },

    // Direct-only: sorted "userIdA_userIdB" pair, backs the uniqueness
    // constraint below. Chat doesn't store members itself (ChatMember
    // does), so this denormalized key is what makes "only one direct
    // chat per pair" enforceable at the database level.
    directPairKey: { type: String, default: null },
  },
  { timestamps: true }
);

chatSchema.index(
  { directPairKey: 1 },
  { unique: true, partialFilterExpression: { type: 'direct' } }
);
chatSchema.index({ lastActivity: -1 });

export const Chat = mongoose.model('Chat', chatSchema);
