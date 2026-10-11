
import type { Request, Response } from 'express';
import {
    getAuditActorRole,
    sendAuditLogFailure,
    writeAuditLog,
} from '../audit/audit-service.js';

import {
    ApiKeyNotFoundError,
    ApiKeyValidationError,
    createUserApiKey,
    listUserApiKeys,
    revokeUserApiKey,
} from './api-key-service.js';

function handleApiKeyError(
    error: unknown,
    response: Response,
): void {
    if (sendAuditLogFailure(error, response)) {
        return;
    }

    if (error instanceof ApiKeyValidationError) {
        response.status(400).json({
            error: {
                code: 'API_KEY_VALIDATION_FAILED',
                message: error.message,
            },
        });
        return;
    }

    if (error instanceof ApiKeyNotFoundError) {
        response.status(404).json({
            error: {
                code: 'API_KEY_NOT_FOUND',
                message: error.message,
            },
        });
        return;
    }

    console.error('API-key operation failed:', error);

    response.status(500).json({
        error: {
            code: 'API_KEY_OPERATION_FAILED',
            message: 'Failed to process API-key request.',
        },
    });
}

export async function createApiKeyController(
    request: Request<{ apiId: string }>,
    response: Response,
): Promise<void> {
    try {
        const result = await createUserApiKey(
            response.locals.user.id,
            request.params.apiId,
            request.body,
        );
        await writeAuditLog({
            actorUserId: response.locals.user.id,
            actorRole: getAuditActorRole(response.locals.user.isAdmin),
            action: 'API_KEY_CREATED',
            resourceType: 'API_KEY',
            resourceId: result.apiKey.id,
            metadata: { apiId: result.apiKey.apiId },
            ipAddress: request.socket.remoteAddress,
        });

        response.status(201).json({
            data: result,
        });
    } catch (error) {
        handleApiKeyError(error, response);
    }
}

export async function listApiKeysController(
    request: Request<{ apiId: string }>,
    response: Response,
): Promise<void> {
    try {
        const keys = await listUserApiKeys(
            response.locals.user.id,
            request.params.apiId,
        );

        response.status(200).json({
            data: keys,
        });
    } catch (error) {
        handleApiKeyError(error, response);
    }
}

export async function revokeApiKeyController(
    request: Request<{ apiKeyId: string }>,
    response: Response,
): Promise<void> {
    try {
        await revokeUserApiKey(
            response.locals.user.id,
            request.params.apiKeyId,
        );
        await writeAuditLog({
            actorUserId: response.locals.user.id,
            actorRole: getAuditActorRole(response.locals.user.isAdmin),
            action: 'API_KEY_REVOKED',
            resourceType: 'API_KEY',
            resourceId: request.params.apiKeyId,
            ipAddress: request.socket.remoteAddress,
        });

        response.status(204).send();
    } catch (error) {
        handleApiKeyError(error, response);
    }
}
