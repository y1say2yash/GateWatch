
import { Router } from 'express';

import { requireAuthentication } from '../auth/session-middleware.js';

import {
    createApiKeyController,
    listApiKeysController,
    revokeApiKeyController,
} from './api-key-controller.js';

const router = Router();

router.use(requireAuthentication);

router.get(
    '/apis/:apiId/keys',
    listApiKeysController,
);

router.post(
    '/apis/:apiId/keys',
    createApiKeyController,
);

router.delete(
    '/api-keys/:apiKeyId',
    revokeApiKeyController,
);

export default router;
