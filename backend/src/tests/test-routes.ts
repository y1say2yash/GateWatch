import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';

import { requireSessionOrAccessToken } from '../auth/access-token-middleware.js';
import { requireAuthentication } from '../auth/session-middleware.js';
import {
    createTestController,
    deleteTestController,
    executeTestController,
    getTestController,
    listTestsController,
    updateTestController,
} from './test-controller.js';

const router = Router();

function validateResourceId(
    request: Request,
    response: Response,
    next: NextFunction,
): void {
    const parameter = request.params.apiId ?? request.params.testId;
    const id = Array.isArray(parameter) ? parameter[0] : parameter;
    if (
        typeof id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    ) {
        response.status(400).json({
            error: {
                code: 'INVALID_RESOURCE_ID',
                message: 'Resource ID must be a valid UUID.',
            },
        });
        return;
    }
    next();
}

router.post(
    '/tests/:testId/execute',
    requireSessionOrAccessToken,
    validateResourceId,
    executeTestController,
);

router.get(
    '/apis/:apiId/tests',
    requireAuthentication,
    validateResourceId,
    listTestsController,
);
router.post(
    '/apis/:apiId/tests',
    requireAuthentication,
    validateResourceId,
    createTestController,
);
router.get(
    '/tests/:testId',
    requireAuthentication,
    validateResourceId,
    getTestController,
);
router.patch(
    '/tests/:testId',
    requireAuthentication,
    validateResourceId,
    updateTestController,
);
router.delete(
    '/tests/:testId',
    requireAuthentication,
    validateResourceId,
    deleteTestController,
);

export default router;
