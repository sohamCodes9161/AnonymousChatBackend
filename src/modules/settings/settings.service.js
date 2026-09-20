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

/**
 * Flattens a nested update object into dot-notation paths before
 * $set — e.g. { privacy: { lastSeenVisibility: 'friends' } } becomes
 * { 'privacy.lastSeenVisibility': 'friends' }. Necessary because
 * Mongo's $set REPLACES a nested object wholesale rather than merging
 * it: without this, updating just lastSeenVisibility would silently
 * wipe out readReceiptsEnabled (and vice versa) any time only one of
 * the two was sent.
 */
function flattenToDotNotation(obj, prefix = '') {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenToDotNotation(value, path));
    } else {
      result[path] = value;
    }
  }
  return result;
}

export async function updateSettings(userId, updates) {
  return UserSettings.findOneAndUpdate(
    { userId },
    { $set: flattenToDotNotation(updates) },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}
