import type { Request, Response } from 'express';

import {
    getAuditActorRole,
    sendAuditLogFailure,
    writeAuditLog,
} from '../audit/audit-service.js';
import {
    createUserTest,
    deleteUserTest,
    executeUserTest,
    getUserTest,
    listUserTests,
    TestApiNotFoundError,
    TestNotFoundError,
    updateUserTest,
} from './test-service.js';
import { TestApiDisabledError, TestExecutionError } from './test-execution.js';
import {
    TestTargetUrlError,
    TestValidationError,
} from './test-validation.js';

function handleTestError(error: unknown, response: Response): void {
    if (sendAuditLogFailure(error, response)) return;
    if (error instanceof TestValidationError) {
        response.status(400).json({
            error: { code: error.code, message: error.message },
        });
        return;
    }
    if (error instanceof TestTargetUrlError) {
        response.status(400).json({
            error: { code: 'UNSAFE_TEST_URL', message: error.message },
        });
        return;
    }
    if (error instanceof TestApiNotFoundError || error instanceof TestNotFoundError) {
        response.status(404).json({
            error: {
                code: error instanceof TestApiNotFoundError ? 'API_NOT_FOUND' : 'TEST_NOT_FOUND',
                message: error.message,
            },
        });
        return;
    }
    if (error instanceof TestApiDisabledError) {
        response.status(503).json({
            error: {
                code: 'API_UNAVAILABLE',
                message: error.message,
            },
        });
        return;
    }
    if (error instanceof TestExecutionError) {
        response.status(400).json({
            error: {
                code: 'TEST_EXECUTION_FAILED',
                message: error.message,
            },
        });
        return;
    }
    if (error instanceof Error && error.message.includes('TEST_CREDENTIAL_ENCRYPTION_KEY')) {
        console.error('Test credential encryption is not configured.');
        response.status(503).json({
            error: {
                code: 'TEST_CREDENTIAL_ENCRYPTION_UNAVAILABLE',
                message: 'Test credential storage is not configured.',
            },
        });
        return;
    }
    if (error instanceof Error &&
        /authentication (password|token|value) is required/i.test(error.message)) {
        response.status(400).json({
            error: {
                code: 'INVALID_TEST_AUTHENTICATION',
                message: error.message,
            },
        });
        return;
    }
    console.error(
        'Test definition operation failed:',
        error instanceof Error ? error.message : 'Unknown error.',
    );
    response.status(500).json({
        error: {
            code: 'TEST_OPERATION_FAILED',
            message: 'Failed to process test definition request.',
        },
    });
}

export async function listTestsController(
    request: Request<{ apiId: string }>,
    response: Response,
): Promise<void> {
    try {
        const data = await listUserTests(response.locals.user.id, request.params.apiId);
        response.status(200).json({ data });
    } catch (error) {
        handleTestError(error, response);
    }
}

export async function createTestController(
    request: Request<{ apiId: string }>,
    response: Response,
): Promise<void> {
    try {
        const test = await createUserTest(
            response.locals.user.id,
            request.params.apiId,
            request.body,
        );
        await writeAuditLog({
            actorUserId: response.locals.user.id,
            actorRole: getAuditActorRole(response.locals.user.isAdmin),
            action: 'TEST_CREATED',
            resourceType: 'TEST',
            resourceId: test.id,
            ipAddress: request.socket.remoteAddress,
        });
        response.status(201).json({ data: test });
    } catch (error) {
        handleTestError(error, response);
    }
}

export async function getTestController(
    request: Request<{ testId: string }>,
    response: Response,
): Promise<void> {
    try {
        response.status(200).json({
            data: await getUserTest(response.locals.user.id, request.params.testId),
        });
    } catch (error) {
        handleTestError(error, response);
    }
}

export async function updateTestController(
    request: Request<{ testId: string }>,
    response: Response,
): Promise<void> {
    try {
        const test = await updateUserTest(
            response.locals.user.id,
            request.params.testId,
            request.body,
        );
        await writeAuditLog({
            actorUserId: response.locals.user.id,
            actorRole: getAuditActorRole(response.locals.user.isAdmin),
            action: 'TEST_UPDATED',
            resourceType: 'TEST',
            resourceId: test.id,
            ipAddress: request.socket.remoteAddress,
        });
        response.status(200).json({ data: test });
    } catch (error) {
        handleTestError(error, response);
    }
}

export async function deleteTestController(
    request: Request<{ testId: string }>,
    response: Response,
): Promise<void> {
    try {
        await deleteUserTest(response.locals.user.id, request.params.testId);
        await writeAuditLog({
            actorUserId: response.locals.user.id,
            actorRole: getAuditActorRole(response.locals.user.isAdmin),
            action: 'TEST_DELETED',
            resourceType: 'TEST',
            resourceId: request.params.testId,
            ipAddress: request.socket.remoteAddress,
        });
        response.status(204).send();
    } catch (error) {
        handleTestError(error, response);
    }
}

export async function executeTestController(
    request: Request<{ testId: string }>,
    response: Response,
): Promise<void> {
    try {
        const execution = await executeUserTest(response.locals.user.id, request.params.testId);
        await writeAuditLog({
            actorUserId: response.locals.user.id,
            actorRole: getAuditActorRole(response.locals.user.isAdmin),
            action: 'TEST_EXECUTED',
            resourceType: 'TEST',
            resourceId: request.params.testId,
            metadata: {
                executionId: execution.id,
                status: execution.status,
                passed: execution.passed,
            },
            ipAddress: request.socket.remoteAddress,
        });
        response.status(200).json({ data: execution });
    } catch (error) {
        handleTestError(error, response);
    }
}
