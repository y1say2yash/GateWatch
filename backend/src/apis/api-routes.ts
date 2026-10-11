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
    updateApiAuthentication,
} from './api-controller.js';
import {
    getApiRateLimitController,
    updateApiRateLimitController,
} from '../rate-limits/rate-limit-controller.js';
import {
    getApiHealthConfigController,
    getApiHealthHistoryController,
    getApiHealthStatusController,
    patchApiHealthConfigController,
    postApiHealthCheckController,
} from '../health/health-controller.js';

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

router.patch(
    '/apis/:apiId/authentication',
    updateApiAuthentication,
);

router.get(
    '/apis/:apiId/rate-limit',
    getApiRateLimitController,
);

router.patch(
    '/apis/:apiId/rate-limit',
    updateApiRateLimitController,
);

router.get(
    '/apis/:apiId/health',
    getApiHealthConfigController,
);

router.patch(
    '/apis/:apiId/health',
    patchApiHealthConfigController,
);

router.post(
    '/apis/:apiId/health/check',
    postApiHealthCheckController,
);

router.get(
    '/apis/:apiId/health/status',
    getApiHealthStatusController,
);

router.get(
    '/apis/:apiId/health/history',
    getApiHealthHistoryController,
);

export default router;