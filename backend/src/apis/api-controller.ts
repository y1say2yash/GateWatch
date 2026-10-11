import type { Request, Response } from 'express';

import {
    ApiNameConflictError,
    ApiNotFoundError,
    createUserApi,
    deleteUserApi,
    disableUserApi,
    enableUserApi,
    getUserApi,
    listUserProjectApis,
    updateUserApi,
    setUserApiAuthenticationRequired,
} from './api-service.js';
import { ApiValidationError } from './api-validation.js';
import {
    getAuditActorRole,
    sendAuditLogFailure,
    writeAuditLog,
} from '../audit/audit-service.js';

function handleApiError(
    error: unknown,
    response: Response,
): void {
    if (sendAuditLogFailure(error, response)) {
        return;
    }

    if (error instanceof ApiValidationError) {
        response.status(400).json({
            error: {
                code: error.code,
                message: error.message,
            },
        });

        return;
    }

    if (error instanceof ApiNameConflictError) {
        response.status(409).json({
            error: {
                code: 'API_NAME_CONFLICT',
                message: error.message,
            },
        });

        return;
    }

    if (error instanceof ApiNotFoundError) {
        response.status(404).json({
            error: {
                code: 'API_NOT_FOUND',
                message: error.message,
            },
        });

        return;
    }

    console.error('API operation failed:', error);

    response.status(500).json({
        error: {
            code: 'API_OPERATION_FAILED',
            message: 'Failed to process API request.',
        },
    });
}

export async function listApis(
    request: Request<{ projectId: string }>,
    response: Response,
): Promise<void> {
    try {
        const apis = await listUserProjectApis(
            response.locals.user.id,
            request.params.projectId,
        );

        response.status(200).json({
            data: apis,
        });
    } catch (error) {
        handleApiError(error, response);
    }
}

export async function createApiController(
    request: Request<{ projectId: string }>,
    response: Response,
): Promise<void> {
    try {
        const api = await createUserApi(
            response.locals.user.id,
            request.params.projectId,
            request.body,
        );
        await writeAuditLog({
            actorUserId: response.locals.user.id,
            actorRole: getAuditActorRole(response.locals.user.isAdmin),
            action: 'API_CREATED',
            resourceType: 'API',
            resourceId: api.id,
            ipAddress: request.socket.remoteAddress,
        });

        response.status(201).json({
            data: api,
        });
    } catch (error) {
        handleApiError(error, response);
    }
}

export async function getApi(
    request: Request<{ apiId: string }>,
    response: Response,
): Promise<void> {
    try {
        const api = await getUserApi(
            response.locals.user.id,
            request.params.apiId,
        );

        response.status(200).json({
            data: api,
        });
    } catch (error) {
        handleApiError(error, response);
    }
}

export async function updateApiController(
    request: Request<{ apiId: string }>,
    response: Response,
): Promise<void> {
    try {
        const api = await updateUserApi(
            response.locals.user.id,
            request.params.apiId,
            request.body,
        );
        await writeAuditLog({
            actorUserId: response.locals.user.id,
            actorRole: getAuditActorRole(response.locals.user.isAdmin),
            action: 'API_UPDATED',
            resourceType: 'API',
            resourceId: api.id,
            ipAddress: request.socket.remoteAddress,
        });

        response.status(200).json({
            data: api,
        });
    } catch (error) {
        handleApiError(error, response);
    }
}

export async function deleteApiController(
    request: Request<{ apiId: string }>,
    response: Response,
): Promise<void> {
    try {
        await deleteUserApi(
            response.locals.user.id,
            request.params.apiId,
        );
        await writeAuditLog({
            actorUserId: response.locals.user.id,
            actorRole: getAuditActorRole(response.locals.user.isAdmin),
            action: 'API_DELETED',
            resourceType: 'API',
            resourceId: request.params.apiId,
            ipAddress: request.socket.remoteAddress,
        });

        response.status(204).send();
    } catch (error) {
        handleApiError(error, response);
    }
}

export async function enableApi(
    request: Request<{ apiId: string }>,
    response: Response,
): Promise<void> {
    try {
        const api = await enableUserApi(
            response.locals.user.id,
            request.params.apiId,
        );
        await writeAuditLog({
            actorUserId: response.locals.user.id,
            actorRole: getAuditActorRole(response.locals.user.isAdmin),
            action: 'API_ENABLED',
            resourceType: 'API',
            resourceId: api.id,
            ipAddress: request.socket.remoteAddress,
        });

        response.status(200).json({
            data: api,
        });
    } catch (error) {
        handleApiError(error, response);
    }
}

export async function disableApi(
    request: Request<{ apiId: string }>,
    response: Response,
): Promise<void> {
    try {
        const api = await disableUserApi(
            response.locals.user.id,
            request.params.apiId,
        );
        await writeAuditLog({
            actorUserId: response.locals.user.id,
            actorRole: getAuditActorRole(response.locals.user.isAdmin),
            action: 'API_DISABLED',
            resourceType: 'API',
            resourceId: api.id,
            ipAddress: request.socket.remoteAddress,
        });

        response.status(200).json({
            data: api,
        });
    } catch (error) {
        handleApiError(error, response);
    }
}

export async function updateApiAuthentication(
    request: Request<{ apiId: string }>,
    response: Response,
): Promise<void> {
    const body: unknown = request.body;

    if (
        typeof body !== 'object' ||
        body === null ||
        !('required' in body) ||
        typeof body.required !== 'boolean'
    ) {
        response.status(400).json({
            error: {
                code: 'INVALID_AUTHENTICATION_CONFIG',
                message: 'The required field must be a boolean.',
            },
        });
        return;
    }

    try {
        const api = await setUserApiAuthenticationRequired(
            response.locals.user.id,
            request.params.apiId,
            body.required,
        );
        await writeAuditLog({
            actorUserId: response.locals.user.id,
            actorRole: getAuditActorRole(response.locals.user.isAdmin),
            action: 'API_AUTHENTICATION_UPDATED',
            resourceType: 'API',
            resourceId: api.id,
            metadata: { required: body.required },
            ipAddress: request.socket.remoteAddress,
        });

        response.status(200).json({ data: api });
    } catch (error) {
        handleApiError(error, response);
    }
}