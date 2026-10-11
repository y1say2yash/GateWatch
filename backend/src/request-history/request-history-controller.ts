import type { Request, Response } from 'express';

import {
    getUserApiRequestHistory,
    getUserRequestHistoryRecord,
    RequestHistoryNotFoundError,
    RequestHistoryValidationError,
    validateRequestHistoryFilters,
} from './request-history-service.js';

function handleRequestHistoryError(
    error: unknown,
    response: Response,
): void {
    if (error instanceof RequestHistoryValidationError) {
        response.status(400).json({
            error: {
                code: 'INVALID_REQUEST_HISTORY_QUERY',
                message: error.message,
            },
        });
        return;
    }

    if (error instanceof RequestHistoryNotFoundError) {
        response.status(404).json({
            error: {
                code: 'REQUEST_HISTORY_NOT_FOUND',
                message: error.message,
            },
        });
        return;
    }

    console.error('Request-history operation failed.');
    response.status(500).json({
        error: {
            code: 'REQUEST_HISTORY_FAILED',
            message: 'Failed to retrieve request history.',
        },
    });
}

export async function listApiRequestHistory(
    request: Request<{ apiId: string }>,
    response: Response,
): Promise<void> {
    try {
        const filters = validateRequestHistoryFilters(
            request.query as Record<string, unknown>,
        );
        const history = await getUserApiRequestHistory(
            response.locals.user.id,
            request.params.apiId,
            filters,
        );

        response.status(200).json({
            data: history.data,
            pagination: {
                page: filters.page,
                limit: filters.limit,
                total: history.total,
                totalPages: Math.ceil(history.total / filters.limit),
            },
        });
    } catch (error) {
        handleRequestHistoryError(error, response);
    }
}

export async function getRequestHistoryRecord(
    request: Request<{ requestId: string }>,
    response: Response,
): Promise<void> {
    try {
        const record = await getUserRequestHistoryRecord(
            response.locals.user.id,
            request.params.requestId,
        );
        response.status(200).json({ data: record });
    } catch (error) {
        handleRequestHistoryError(error, response);
    }
}
