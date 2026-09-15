import { Router } from 'express';
import * as settingsController from './settings.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { updateSettingsSchema } from './settings.validation.js';

const router = Router();

router.use(authenticate);

router.get('/', settingsController.getSettings);
router.patch('/', validate(updateSettingsSchema), settingsController.updateSettings);

export default router;
