import type { Request, Response } from 'express';

import {
    getAuditActorRole,
    sendAuditLogFailure,
    writeAuditLog,
} from '../audit/audit-service.js';
import {
    createUserApiRoute,
    deleteUserApiRoute,
    listUserApiRoutes,
    RouteConflictError,
    RouteNotFoundError,
    updateUserApiRoute,
} from './route-service.js';

import { RouteValidationError } from './route-validation.js';

function handleRouteError(
    error: unknown,
    response: Response,
): void {
    if (sendAuditLogFailure(error, response)) {
        return;
    }

    if (error instanceof RouteValidationError) {
        response.status(400).json({
            error: {
                code: error.code,
                message: error.message,
            },
        });

        return;
    }

    if (error instanceof RouteConflictError) {
        response.status(409).json({
            error: {
                code: 'ROUTE_CONFLICT',
                message: error.message,
            },
        });

        return;
    }

    if (error instanceof RouteNotFoundError) {
        response.status(404).json({
            error: {
                code: 'ROUTE_NOT_FOUND',
                message: error.message,
            },
        });

        return;
    }

    console.error('Route operation failed:', error);

    response.status(500).json({
        error: {
            code: 'ROUTE_OPERATION_FAILED',
            message: 'Failed to process route request.',
        },
    });
}

export async function listRoutes(
    request: Request<{ apiId: string }>,
    response: Response,
): Promise<void> {
    try {
        const routes = await listUserApiRoutes(
            response.locals.user.id,
            request.params.apiId,
        );

        response.status(200).json({
            data: routes,
        });
    } catch (error) {
        handleRouteError(error, response);
    }
}

export async function createRouteController(
    request: Request<{ apiId: string }>,
    response: Response,
): Promise<void> {
    try {
        const route = await createUserApiRoute(
            response.locals.user.id,
            request.params.apiId,
            request.body,
        );
        await writeAuditLog({
            actorUserId: response.locals.user.id,
            actorRole: getAuditActorRole(response.locals.user.isAdmin),
            action: 'API_ROUTE_CREATED',
            resourceType: 'API_ROUTE',
            resourceId: route.id,
            metadata: { apiId: route.apiId },
            ipAddress: request.socket.remoteAddress,
        });

        response.status(201).json({
            data: route,
        });
    } catch (error) {
        handleRouteError(error, response);
    }
}

export async function updateRouteController(
    request: Request<{ routeId: string }>,
    response: Response,
): Promise<void> {
    try {
        const route = await updateUserApiRoute(
            response.locals.user.id,
            request.params.routeId,
            request.body,
        );
        await writeAuditLog({
            actorUserId: response.locals.user.id,
            actorRole: getAuditActorRole(response.locals.user.isAdmin),
            action: 'API_ROUTE_UPDATED',
            resourceType: 'API_ROUTE',
            resourceId: route.id,
            metadata: { apiId: route.apiId },
            ipAddress: request.socket.remoteAddress,
        });

        response.status(200).json({
            data: route,
        });
    } catch (error) {
        handleRouteError(error, response);
    }
}

export async function deleteRouteController(
    request: Request<{ routeId: string }>,
    response: Response,
): Promise<void> {
    try {
        await deleteUserApiRoute(
            response.locals.user.id,
            request.params.routeId,
        );
        await writeAuditLog({
            actorUserId: response.locals.user.id,
            actorRole: getAuditActorRole(response.locals.user.isAdmin),
            action: 'API_ROUTE_DELETED',
            resourceType: 'API_ROUTE',
            resourceId: request.params.routeId,
            ipAddress: request.socket.remoteAddress,
        });

        response.status(204).send();
    } catch (error) {
        handleRouteError(error, response);
    }
}