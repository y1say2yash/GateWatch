import { findAuditLogs } from './admin-repository.js';
import type { AuditLogFilters } from './admin-types.js';

export class AuditLogQueryValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AuditLogQueryValidationError';
    }
}

const ALLOWED_QUERY_KEYS = new Set(['page', 'limit', 'from', 'to']);

function getQueryString(
    query: Record<string, unknown>,
    key: string,
): string | undefined {
    const value = query[key];
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== 'string') {
        throw new AuditLogQueryValidationError(
            `${key} must be provided once as a string.`,
        );
    }
    return value;
}

function parseInteger(
    value: string | undefined,
    key: string,
    defaultValue: number,
    minimum: number,
    maximum: number,
): number {
    if (value === undefined) {
        return defaultValue;
    }
    if (!/^\d+$/.test(value)) {
        throw new AuditLogQueryValidationError(
            `${key} must be an integer between ${minimum} and ${maximum}.`,
        );
    }

    const parsed = Number(value);
    if (
        !Number.isSafeInteger(parsed) ||
        parsed < minimum ||
        parsed > maximum
    ) {
        throw new AuditLogQueryValidationError(
            `${key} must be an integer between ${minimum} and ${maximum}.`,
        );
    }
    return parsed;
}

function parseDate(
    value: string | undefined,
    key: string,
): Date | undefined {
    if (value === undefined) {
        return undefined;
    }
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) {
        throw new AuditLogQueryValidationError(
            `${key} must be a valid timestamp.`,
        );
    }
    return parsed;
}

export function validateAuditLogFilters(
    query: Record<string, unknown>,
): AuditLogFilters {
    for (const key of Object.keys(query)) {
        if (!ALLOWED_QUERY_KEYS.has(key)) {
            throw new AuditLogQueryValidationError(
                `Unsupported audit-log query parameter: ${key}.`,
            );
        }
    }

    const page = parseInteger(
        getQueryString(query, 'page'),
        'page',
        1,
        1,
        Number.MAX_SAFE_INTEGER,
    );
    const limit = parseInteger(
        getQueryString(query, 'limit'),
        'limit',
        20,
        1,
        100,
    );
    if (!Number.isSafeInteger((page - 1) * limit)) {
        throw new AuditLogQueryValidationError(
            'page and limit exceed the supported offset range.',
        );
    }

    const from = parseDate(getQueryString(query, 'from'), 'from');
    const to = parseDate(getQueryString(query, 'to'), 'to');
    if (from && to && from > to) {
        throw new AuditLogQueryValidationError(
            'from must be earlier than or equal to to.',
        );
    }

    return { page, limit, from, to };
}

export async function getAuditLogPage(filters: AuditLogFilters) {
    return findAuditLogs(filters);
}
