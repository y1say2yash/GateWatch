import type { Request, Response } from 'express';

import database from '../config/database.js';
import {
    getAuditActorRole,
    sendAuditLogFailure,
    writeAuditLog,
} from '../audit/audit-service.js';
import {
    AccessTokenNotFoundError,
    AccessTokenValidationError,
    createUserAccessToken,
    listUserAccessTokens,
    revokeUserAccessToken,
} from './access-token-service.js';

function handleAccessTokenError(error: unknown, response: Response): void {
    if (sendAuditLogFailure(error, response)) return;
    if (error instanceof AccessTokenValidationError) {
        response.status(400).json({
            error: {
                code: 'ACCESS_TOKEN_VALIDATION_FAILED',
                message: error.message,
            },
        });
        return;
    }
    if (error instanceof AccessTokenNotFoundError) {
        response.status(404).json({
            error: {
                code: 'ACCESS_TOKEN_NOT_FOUND',
                message: error.message,
            },
        });
        return;
    }
    console.error('Access-token operation failed:', error);
    response.status(500).json({
        error: {
            code: 'ACCESS_TOKEN_OPERATION_FAILED',
            message: 'Failed to process access-token request.',
        },
    });
}

export async function createAccessTokenController(
    request: Request,
    response: Response,
): Promise<void> {
    try {
        const result = await database.transaction(async (transaction) => {
            const created = await createUserAccessToken(
                response.locals.user.id,
                request.body,
                transaction,
            );
            await writeAuditLog({
                actorUserId: response.locals.user.id,
                actorRole: getAuditActorRole(response.locals.user.isAdmin),
                action: 'ACCESS_TOKEN_CREATED',
                resourceType: 'ACCESS_TOKEN',
                resourceId: created.accessToken.id,
                ipAddress: request.socket.remoteAddress,
            }, transaction);
            return created;
        });
        response.status(201).json({ data: result });
    } catch (error) {
        handleAccessTokenError(error, response);
    }
}

export async function listAccessTokensController(
    _request: Request,
    response: Response,
): Promise<void> {
    try {
        response.status(200).json({
            data: await listUserAccessTokens(response.locals.user.id),
        });
    } catch (error) {
        handleAccessTokenError(error, response);
    }
}

export async function revokeAccessTokenController(
    request: Request<{ accessTokenId: string }>,
    response: Response,
): Promise<void> {
    try {
        await revokeUserAccessToken(
            response.locals.user.id,
            request.params.accessTokenId,
        );
        await writeAuditLog({
            actorUserId: response.locals.user.id,
            actorRole: getAuditActorRole(response.locals.user.isAdmin),
            action: 'ACCESS_TOKEN_REVOKED',
            resourceType: 'ACCESS_TOKEN',
            resourceId: request.params.accessTokenId,
            ipAddress: request.socket.remoteAddress,
        });
        response.status(204).send();
    } catch (error) {
        handleAccessTokenError(error, response);
    }
}
