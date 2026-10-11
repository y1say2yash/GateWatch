import type { Request, Response } from 'express';
import {
    getAuditActorRole,
    sendAuditLogFailure,
    writeAuditLog,
} from '../audit/audit-service.js';

import {
    RateLimitConfigNotFoundError,
    getUserApiRateLimitConfig,
    setUserApiRateLimitConfig,
} from './rate-limit-service.js';
import {
    RateLimitValidationError,
    validateRateLimitConfig,
} from './rate-limit-validation.js';

function handleRateLimitConfigError(
    error: unknown,
    response: Response,
): void {
    if (sendAuditLogFailure(error, response)) {
        return;
    }

    if (error instanceof RateLimitValidationError) {
        response.status(400).json({
            error: {
                code: 'INVALID_RATE_LIMIT_CONFIG',
                message: error.message,
            },
        });
        return;
    }

    if (error instanceof RateLimitConfigNotFoundError) {
        response.status(404).json({
            error: {
                code: 'API_NOT_FOUND',
                message: error.message,
            },
        });
        return;
    }

    console.error('Rate-limit configuration operation failed:', error);

    response.status(500).json({
        error: {
            code: 'RATE_LIMIT_CONFIG_OPERATION_FAILED',
            message: 'Failed to process rate-limit configuration.',
        },
    });
}

export async function getApiRateLimitController(
    request: Request<{ apiId: string }>,
    response: Response,
): Promise<void> {
    try {
        const config = await getUserApiRateLimitConfig(
            response.locals.user.id,
            request.params.apiId,
        );

        response.status(200).json({ data: config });
    } catch (error) {
        handleRateLimitConfigError(error, response);
    }
}

export async function updateApiRateLimitController(
    request: Request<{ apiId: string }>,
    response: Response,
): Promise<void> {
    try {
        const input = validateRateLimitConfig(request.body);
        const config = await setUserApiRateLimitConfig(
            response.locals.user.id,
            request.params.apiId,
            input,
        );
        await writeAuditLog({
            actorUserId: response.locals.user.id,
            actorRole: getAuditActorRole(response.locals.user.isAdmin),
            action: 'RATE_LIMIT_CONFIG_UPDATED',
            resourceType: 'API',
            resourceId: config.apiId,
            ipAddress: request.socket.remoteAddress,
        });

        response.status(200).json({ data: config });
    } catch (error) {
        handleRateLimitConfigError(error, response);
    }
}
