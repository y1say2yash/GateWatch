import type { Request, Response } from 'express';

import {
    getUserApiMonitoringSummary,
    getUserApiMonitoringTimeSeries,
    MonitoringApiNotFoundError,
    MonitoringValidationError,
    validateMonitoringDateRange,
    validateMonitoringTimeSeriesRange,
} from './monitoring-service.js';

function sendMonitoringError(error: unknown, response: Response, operation: 'summary' | 'time series'): void {
    if (error instanceof MonitoringValidationError) {
        response.status(400).json({
            error: {
                code: 'INVALID_MONITORING_QUERY',
                message: error.message,
            },
        });
        return;
    }

    if (error instanceof MonitoringApiNotFoundError) {
        response.status(404).json({
            error: {
                code: 'API_NOT_FOUND',
                message: error.message,
            },
        });
        return;
    }

    console.error(`API monitoring ${operation} failed.`);
    response.status(500).json({
        error: {
            code: operation === 'summary'
                ? 'MONITORING_SUMMARY_FAILED'
                : 'MONITORING_TIME_SERIES_FAILED',
            message: operation === 'summary'
                ? 'Failed to retrieve API monitoring summary.'
                : 'Failed to retrieve API monitoring time series.',
        },
    });
}

export async function getApiMonitoringSummary(
    request: Request<{ apiId: string }>,
    response: Response,
): Promise<void> {
    try {
        const range = validateMonitoringDateRange(
            request.query as Record<string, unknown>,
        );
        const summary = await getUserApiMonitoringSummary(
            response.locals.user.id,
            request.params.apiId,
            range,
        );
        response.status(200).json({ data: summary });
    } catch (error) {
        sendMonitoringError(error, response, 'summary');
    }
}

export async function getApiMonitoringTimeSeries(
    request: Request<{ apiId: string }>,
    response: Response,
): Promise<void> {
    try {
        const range = validateMonitoringTimeSeriesRange(
            request.query as Record<string, unknown>,
        );
        const series = await getUserApiMonitoringTimeSeries(
            response.locals.user.id,
            request.params.apiId,
            range,
        );
        response.status(200).json({ data: series });
    } catch (error) {
        sendMonitoringError(error, response, 'time series');
    }
}
