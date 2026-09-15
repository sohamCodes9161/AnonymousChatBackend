import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      enum: [
        'friend_request_received',
        'friend_request_accepted',
        'group_member_added',
        'group_role_changed',
      ],
      required: true,
    },
    // Shape varies by type — same content-varies-by-type pattern as Message.
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, createdAt: -1 }); // paginated list
notificationSchema.index({ userId: 1, readAt: 1 }); // unread count

notificationSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id,
    type: this.type,
    payload: this.payload,
    readAt: this.readAt,
    createdAt: this.createdAt,
  };
};

export const Notification = mongoose.model('Notification', notificationSchema);
