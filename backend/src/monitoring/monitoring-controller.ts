import type { Request, Response } from 'express';

import {
    getUserApiMonitoringSummary,
    MonitoringApiNotFoundError,
    MonitoringValidationError,
    validateMonitoringDateRange,
} from './monitoring-service.js';

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

        console.error('API monitoring summary failed.');
        response.status(500).json({
            error: {
                code: 'MONITORING_SUMMARY_FAILED',
                message: 'Failed to retrieve API monitoring summary.',
            },
        });
    }
}
