import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';

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

router.use(requireAuthentication);
router.get('/apis/:apiId/tests', validateResourceId, listTestsController);
router.post('/apis/:apiId/tests', validateResourceId, createTestController);
router.get('/tests/:testId', validateResourceId, getTestController);
router.patch('/tests/:testId', validateResourceId, updateTestController);
router.delete('/tests/:testId', validateResourceId, deleteTestController);
router.post('/tests/:testId/execute', validateResourceId, executeTestController);

export default router;
