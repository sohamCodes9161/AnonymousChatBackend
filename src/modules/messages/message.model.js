import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema(
  {
    chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: function () {
        return this.type !== 'system';
      },
      default: null,
    },
    // Nullable — set when Incognito System exists and a session is
    // active on this chat at send-time. Null = ordinary message.
    incognitoSessionId: { type: mongoose.Schema.Types.ObjectId, default: null },

    type: { type: String, enum: ['text', 'system'], default: 'text' },
    // Shape varies by type — { text } for now. Extensible later
    // (image/attachment metadata etc.) without a schema migration.
    content: { type: mongoose.Schema.Types.Mixed, required: true },

    replyToMessageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
    status: { type: String, enum: ['sent', 'edited', 'deleted'], default: 'sent' },

    // Client-generated — makes send idempotent against network retries.
    clientMessageId: { type: String, default: null },

    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Paginated history + reconnect catch-up ("messages after X").
messageSchema.index({ chatId: 1, _id: -1 });
// Bulk delete on Incognito session cleanup.
messageSchema.index({ incognitoSessionId: 1 });
// Idempotent send — a retried request with the same clientMessageId
// resolves to the existing message instead of creating a duplicate.
messageSchema.index(
  { chatId: 1, senderId: 1, clientMessageId: 1 },
  { unique: true, partialFilterExpression: { clientMessageId: { $type: 'string' } } }
);

messageSchema.methods.toPublicJSON = function toPublicJSON() {
  const base = {
    id: this._id,
    chatId: this.chatId,
    senderId: this.senderId,
    replyToMessageId: this.replyToMessageId,
    status: this.status,
    createdAt: this.createdAt,
    editedAt: this.editedAt,
    incognitoSessionId: this.incognitoSessionId,
  };

  if (this.status === 'deleted') {
    // Content is stripped, not just hidden client-side — matches the
    // soft-delete promise (the row stays for reply-thread integrity,
    // but nothing sensitive lingers in it).
    return { ...base, type: 'text', content: { text: null }, deletedAt: this.deletedAt };
  }

  return { ...base, type: this.type, content: this.content };
};

export const Message = mongoose.model('Message', messageSchema);
