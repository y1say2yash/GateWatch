import { Router } from 'express';

import {
    getCurrentUser,
    githubCallback,
    githubLogin,
    logout,
} from './auth-controller.js';
import { requireAuthentication } from './session-middleware.js';

const router = Router();

router.get('/github', githubLogin);
router.get('/github/callback', githubCallback);
router.post('/logout', logout);

router.get('/me', requireAuthentication, getCurrentUser);

export default router;