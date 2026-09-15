import { Router } from 'express';
import * as usersController from './users.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { updateProfileSchema } from './users.validation.js';
import { avatarUpload } from '../../middleware/upload.js';

const router = Router();

router.use(authenticate); // every route below requires a logged-in user

router.get('/search', usersController.search);
router.get('/:userId', usersController.getProfile);
router.patch('/me', validate(updateProfileSchema), usersController.updateProfile);
router.post('/me/avatar', avatarUpload, usersController.uploadAvatar);

export default router;
