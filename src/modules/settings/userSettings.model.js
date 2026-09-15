import mongoose from 'mongoose';

const userSettingsSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    themePreference: { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
    notificationPreferences: {
      friendRequests: { type: Boolean, default: true },
      friendAccepted: { type: Boolean, default: true },
      groupEvents: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

export const UserSettings = mongoose.model('UserSettings', userSettingsSchema);
