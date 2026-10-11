import type { Request, Response } from 'express';

import { rescheduleHealthChecks } from './health-scheduler.js';
import {
    HealthApiNotActiveError,
    HealthApiNotFoundError,
    HealthCheckAlreadyRunningError,
    HealthCheckDisabledError,
    HealthMonitoringUnavailableError,
    getUserHealthCheckConfig,
    getUserHealthHistory,
    getUserHealthStatus,
    patchUserHealthCheckConfig,
    runUserHealthCheck,
} from './health-service.js';
import {
    HealthConfigValidationError,
    validateHealthConfigUpdate,
} from './health-validation.js';

const MAX_HISTORY_LIMIT = 100;
const DEFAULT_HISTORY_LIMIT = 20;

class InvalidHealthHistoryLimitError extends Error {
    constructor() {
        super(`limit must be an integer between 1 and ${MAX_HISTORY_LIMIT}.`);
        this.name = 'InvalidHealthHistoryLimitError';
    }
}

function handleHealthError(
    error: unknown,
    response: Response,
): void {
    if (error instanceof HealthConfigValidationError) {
        response.status(400).json({
            error: {
                code: 'INVALID_HEALTH_CHECK_CONFIG',
                message: error.message,
            },
        });
        return;
    }

    if (error instanceof InvalidHealthHistoryLimitError) {
        response.status(400).json({
            error: {
                code: 'INVALID_HEALTH_HISTORY_LIMIT',
                message: error.message,
            },
        });
        return;
    }

    if (error instanceof HealthApiNotFoundError) {
        response.status(404).json({
            error: {
                code: 'API_NOT_FOUND',
                message: error.message,
            },
        });
        return;
    }

    if (
        error instanceof HealthApiNotActiveError ||
        error instanceof HealthCheckDisabledError ||
        error instanceof HealthCheckAlreadyRunningError
    ) {
        response.status(409).json({
            error: {
                code:
                    error instanceof HealthApiNotActiveError
                        ? 'API_NOT_ACTIVE'
                        : error instanceof HealthCheckDisabledError
                            ? 'HEALTH_CHECKS_DISABLED'
                            : 'HEALTH_CHECK_ALREADY_RUNNING',
                message: error.message,
            },
        });
        return;
    }

    if (error instanceof HealthMonitoringUnavailableError) {
        console.error('Health-monitoring operation failed:', error);
        response.status(503).json({
            error: {
                code: 'HEALTH_MONITORING_UNAVAILABLE',
                message: 'Health monitoring is temporarily unavailable.',
            },
        });
        return;
    }

    console.error('Health-monitoring operation failed:', error);
    response.status(500).json({
        error: {
            code: 'HEALTH_MONITORING_FAILED',
            message: 'Failed to process health-monitoring request.',
        },
    });
}

function getHistoryLimit(value: unknown): number {
    if (value === undefined) {
        return DEFAULT_HISTORY_LIMIT;
    }

    const parsed = typeof value === 'string' ? Number(value) : NaN;
    if (
        !Number.isSafeInteger(parsed) ||
        parsed < 1 ||
        parsed > MAX_HISTORY_LIMIT
    ) {
        throw new InvalidHealthHistoryLimitError();
    }

    return parsed;
}

export async function getApiHealthConfigController(
    request: Request<{ apiId: string }>,
    response: Response,
): Promise<void> {
    try {
        const config = await getUserHealthCheckConfig(
            response.locals.user.id,
            request.params.apiId,
        );
        response.status(200).json({ data: config });
    } catch (error) {
        handleHealthError(error, response);
    }
}

export async function patchApiHealthConfigController(
    request: Request<{ apiId: string }>,
    response: Response,
): Promise<void> {
    try {
        const updates = validateHealthConfigUpdate(request.body);
        const config = await patchUserHealthCheckConfig(
            response.locals.user.id,
            request.params.apiId,
            updates,
        );
        rescheduleHealthChecks();
        response.status(200).json({ data: config });
    } catch (error) {
        handleHealthError(error, response);
    }
}

export async function postApiHealthCheckController(
    request: Request<{ apiId: string }>,
    response: Response,
): Promise<void> {
    try {
        const result = await runUserHealthCheck(
            response.locals.user.id,
            request.params.apiId,
        );
        response.status(200).json({ data: result });
    } catch (error) {
        handleHealthError(error, response);
    }
}

export async function getApiHealthStatusController(
    request: Request<{ apiId: string }>,
    response: Response,
): Promise<void> {
    try {
        const status = await getUserHealthStatus(
            response.locals.user.id,
            request.params.apiId,
        );
        response.status(200).json({ data: status });
    } catch (error) {
        handleHealthError(error, response);
    }
}

export async function getApiHealthHistoryController(
    request: Request<{ apiId: string }>,
    response: Response,
): Promise<void> {
    try {
        const limit = getHistoryLimit(request.query.limit);
        const history = await getUserHealthHistory(
            response.locals.user.id,
            request.params.apiId,
            limit,
        );
        response.status(200).json({
            data: history,
            pagination: { limit },
        });
    } catch (error) {
        handleHealthError(error, response);
    }
}
