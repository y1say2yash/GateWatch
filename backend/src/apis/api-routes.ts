import { Router } from 'express';

import { requireAuthentication } from '../auth/session-middleware.js';
import {
    createApiController,
    deleteApiController,
    disableApi,
    enableApi,
    getApi,
    listApis,
    updateApiController,
} from './api-controller.js';

const router = Router();

router.use(requireAuthentication);

router.get(
    '/projects/:projectId/apis',
    listApis,
);

router.post(
    '/projects/:projectId/apis',
    createApiController,
);

router.get(
    '/apis/:apiId',
    getApi,
);

router.patch(
    '/apis/:apiId',
    updateApiController,
);

router.delete(
    '/apis/:apiId',
    deleteApiController,
);

router.post(
    '/apis/:apiId/enable',
    enableApi,
);

router.post(
    '/apis/:apiId/disable',
    disableApi,
);

export default router;