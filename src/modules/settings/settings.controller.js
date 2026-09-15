import * as settingsService from './settings.service.js';

export async function getSettings(req, res, next) {
  try {
    const settings = await settingsService.getSettings(req.user.id);
    res.json({ success: true, data: { settings } });
  } catch (err) {
    next(err);
  }
}

export async function updateSettings(req, res, next) {
  try {
    const settings = await settingsService.updateSettings(req.user.id, req.body);
    res.json({ success: true, data: { settings } });
  } catch (err) {
    next(err);
  }
}
