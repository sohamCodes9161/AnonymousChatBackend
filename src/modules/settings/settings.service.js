import { UserSettings } from './userSettings.model.js';

export async function getSettings(userId) {
  let settings = await UserSettings.findOne({ userId });
  if (!settings) {
    // Lazily created on first access — no need for a hook at
    // registration time for a feature most users won't touch immediately.
    settings = await UserSettings.create({ userId });
  }
  return settings;
}

export async function updateSettings(userId, updates) {
  return UserSettings.findOneAndUpdate(
    { userId },
    { $set: updates },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}
