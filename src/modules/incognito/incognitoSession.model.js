import mongoose from 'mongoose';

const incognitoSessionSchema = new mongoose.Schema(
  {
    chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true, index: true },
    status: { type: String, enum: ['active', 'ended'], default: 'active' },
    startedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    startedAt: { type: Date, default: Date.now },
    // Non-null while in the presence-based grace period (fewer than 2
    // participants actively online). Null = fully active. Deliberately
    // NOT a separate status value — "grace period" is "active, but on
    // notice," not a distinct lifecycle state, which keeps the
    // uniqueness constraint below simple (one 'active' row per chat
    // covers both cases).
    gracePeriodExpiresAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// One active session per chat, enforced at the database level — backs
// the idempotent-start behavior with a real constraint, not just
// application logic.
incognitoSessionSchema.index(
  { chatId: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } }
);
// Sweep job query — find expired grace periods without scanning every session.
incognitoSessionSchema.index({ status: 1, gracePeriodExpiresAt: 1 });

export const IncognitoSession = mongoose.model('IncognitoSession', incognitoSessionSchema);
