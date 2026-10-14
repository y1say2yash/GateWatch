import type { Request, Response } from 'express';

import {
    getAuditActorRole,
    sendAuditLogFailure,
    writeAuditLog,
} from '../audit/audit-service.js';
import {
    AlertNotFoundError,
    createUserAlert,
    deleteUserAlert,
    getUserAlert,
    listUserApiAlerts,
    setUserAlertEnabled,
    updateUserAlert,
} from './alert-service.js';
import { AlertValidationError } from './alert-validation.js';

function handleAlertError(error: unknown, response: Response): void {
    if (sendAuditLogFailure(error, response)) {
        return;
    }
    if (error instanceof AlertValidationError) {
        response.status(400).json({
            error: {
                code: 'INVALID_ALERT_CONFIG',
                message: error.message,
            },
        });
        return;
    }
    if (error instanceof AlertNotFoundError) {
        response.status(404).json({
            error: {
                code: 'ALERT_NOT_FOUND',
                message: error.message,
            },
        });
        return;
    }

    console.error('Alert configuration operation failed:', error);
    response.status(500).json({
        error: {
            code: 'ALERT_OPERATION_FAILED',
            message: 'Failed to process alert configuration request.',
        },
    });
}

function auditActor(response: Response) {
    return {
        actorUserId: response.locals.user.id,
        actorRole: getAuditActorRole(response.locals.user.isAdmin),
    };
}

export async function listApiAlertsController(
    request: Request<{ apiId: string }>,
    response: Response,
): Promise<void> {
    try {
        const alerts = await listUserApiAlerts(
            response.locals.user.id,
            request.params.apiId,
        );
        response.status(200).json({ data: alerts });
    } catch (error) {
        handleAlertError(error, response);
    }
}

export async function createAlertController(
    request: Request<{ apiId: string }>,
    response: Response,
): Promise<void> {
    try {
        const alert = await createUserAlert(
            response.locals.user.id,
            request.params.apiId,
            request.body,
        );
        await writeAuditLog({
            ...auditActor(response),
            action: 'ALERT_CONFIGURATION_CREATED',
            resourceType: 'ALERT',
            resourceId: alert.id,
            metadata: { name: alert.name, type: alert.type },
            ipAddress: request.socket.remoteAddress,
        });
        response.status(201).json({ data: alert });
    } catch (error) {
        handleAlertError(error, response);
    }
}

export async function getAlertController(
    request: Request<{ alertId: string }>,
    response: Response,
): Promise<void> {
    try {
        const alert = await getUserAlert(
            response.locals.user.id,
            request.params.alertId,
        );
        response.status(200).json({ data: alert });
    } catch (error) {
        handleAlertError(error, response);
    }
}

export async function updateAlertController(
    request: Request<{ alertId: string }>,
    response: Response,
): Promise<void> {
    try {
        const alert = await updateUserAlert(
            response.locals.user.id,
            request.params.alertId,
            request.body,
        );
        await writeAuditLog({
            ...auditActor(response),
            action: 'ALERT_CONFIGURATION_UPDATED',
            resourceType: 'ALERT',
            resourceId: alert.id,
            metadata: {
                type: alert.type,
            },
            ipAddress: request.socket.remoteAddress,
        });
        response.status(200).json({ data: alert });
    } catch (error) {
        handleAlertError(error, response);
    }
}

async function setAlertEnabledController(
    request: Request<{ alertId: string }>,
    response: Response,
    enabled: boolean,
): Promise<void> {
    try {
        const alert = await setUserAlertEnabled(
            response.locals.user.id,
            request.params.alertId,
            enabled,
        );
        await writeAuditLog({
            ...auditActor(response),
            action: enabled
                ? 'ALERT_CONFIGURATION_ENABLED'
                : 'ALERT_CONFIGURATION_DISABLED',
            resourceType: 'ALERT',
            resourceId: alert.id,
            metadata: { enabled },
            ipAddress: request.socket.remoteAddress,
        });
        response.status(200).json({ data: alert });
    } catch (error) {
        handleAlertError(error, response);
    }
}

export function enableAlertController(
    request: Request<{ alertId: string }>,
    response: Response,
): Promise<void> {
    return setAlertEnabledController(request, response, true);
}

export function disableAlertController(
    request: Request<{ alertId: string }>,
    response: Response,
): Promise<void> {
    return setAlertEnabledController(request, response, false);
}

export async function deleteAlertController(
    request: Request<{ alertId: string }>,
    response: Response,
): Promise<void> {
    try {
        await deleteUserAlert(
            response.locals.user.id,
            request.params.alertId,
        );
        await writeAuditLog({
            ...auditActor(response),
            action: 'ALERT_CONFIGURATION_DELETED',
            resourceType: 'ALERT',
            resourceId: request.params.alertId,
            ipAddress: request.socket.remoteAddress,
        });
        response.status(204).send();
    } catch (error) {
        handleAlertError(error, response);
    }
}
