import type { Request, Response } from 'express';

import {
    AuditLogQueryValidationError,
    getAuditLogPage,
    validateAuditLogFilters,
} from './admin-service.js';

export function handleAuditLogListError(
    error: unknown,
    response: Response,
): void {
    if (error instanceof AuditLogQueryValidationError) {
        response.status(400).json({
            error: {
                code: 'INVALID_AUDIT_LOG_QUERY',
                message: error.message,
            },
        });
        return;
    }

    console.error('Audit-log listing failed.');
    response.status(500).json({
        error: {
            code: 'AUDIT_LOG_LIST_FAILED',
            message: 'Failed to retrieve audit logs.',
        },
    });
}

export async function listAuditLogsController(
    request: Request,
    response: Response,
): Promise<void> {
    try {
        const filters = validateAuditLogFilters(
            request.query as Record<string, unknown>,
        );
        const result = await getAuditLogPage(filters);
        response.status(200).json({
            data: result.data,
            pagination: {
                page: filters.page,
                limit: filters.limit,
                total: result.total,
                totalPages: Math.ceil(result.total / filters.limit),
            },
        });
    } catch (error) {
        handleAuditLogListError(error, response);
    }
}
