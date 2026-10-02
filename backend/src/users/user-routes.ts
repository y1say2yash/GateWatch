import { Router } from 'express';

import { requireAuthentication } from '../auth/session-middleware.js';
import {
    deleteCurrentUser,
    getCurrentUserProfile,
} from './user-controller.js';

const router = Router();

router.get('/me', requireAuthentication, getCurrentUserProfile);
router.delete('/me', requireAuthentication, deleteCurrentUser);

export default router;