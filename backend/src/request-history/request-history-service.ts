import {
    findOwnedApiRequestHistory,
    findOwnedRequestHistoryRecord,
} from './request-history-repository.js';
import type { RequestHistoryFilters } from './request-history-types.js';

export class RequestHistoryNotFoundError extends Error {
    constructor() {
        super('Request history was not found.');
        this.name = 'RequestHistoryNotFoundError';
    }
}

export class RequestHistoryValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RequestHistoryValidationError';
    }
}

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_QUERY_KEYS = new Set([
    'page',
    'limit',
    'statusCode',
    'method',
    'from',
    'to',
    'sort',
    'order',
]);

function getQueryString(
    query: Record<string, unknown>,
    key: string,
): string | undefined {
    const value = query[key];
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== 'string') {
        throw new RequestHistoryValidationError(
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
        throw new RequestHistoryValidationError(
            `${key} must be an integer between ${minimum} and ${maximum}.`,
        );
    }

    const parsed = Number(value);
    if (
        !Number.isSafeInteger(parsed) ||
        parsed < minimum ||
        parsed > maximum
    ) {
        throw new RequestHistoryValidationError(
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
        throw new RequestHistoryValidationError(
            `${key} must be a valid timestamp.`,
        );
    }
    return parsed;
}

export function validateRequestHistoryFilters(
    query: Record<string, unknown>,
): RequestHistoryFilters {
    for (const key of Object.keys(query)) {
        if (!ALLOWED_QUERY_KEYS.has(key)) {
            throw new RequestHistoryValidationError(
                `Unsupported request-history query parameter: ${key}.`,
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
        throw new RequestHistoryValidationError(
            'page and limit exceed the supported offset range.',
        );
    }
    const statusValue = getQueryString(query, 'statusCode');
    const statusCode = statusValue === undefined
        ? undefined
        : parseInteger(statusValue, 'statusCode', 0, 100, 599);
    const method = getQueryString(query, 'method');
    const allowedMethods = new Set([
        'GET',
        'POST',
        'PUT',
        'PATCH',
        'DELETE',
        'HEAD',
        'OPTIONS',
    ]);

    if (method !== undefined && !allowedMethods.has(method)) {
        throw new RequestHistoryValidationError(
            'method must be a supported HTTP method.',
        );
    }

    const sort = getQueryString(query, 'sort') ?? 'timestamp';
    if (sort !== 'timestamp') {
        throw new RequestHistoryValidationError(
            'sort must be timestamp.',
        );
    }

    const order = getQueryString(query, 'order') ?? 'desc';
    if (order !== 'asc' && order !== 'desc') {
        throw new RequestHistoryValidationError(
            'order must be asc or desc.',
        );
    }

    const from = parseDate(getQueryString(query, 'from'), 'from');
    const to = parseDate(getQueryString(query, 'to'), 'to');
    if (from && to && from > to) {
        throw new RequestHistoryValidationError(
            'from must be earlier than or equal to to.',
        );
    }

    return {
        page,
        limit,
        statusCode,
        method,
        from,
        to,
        sort,
        order,
    };
}

export async function getUserApiRequestHistory(
    userId: string,
    apiId: string,
    filters: RequestHistoryFilters,
) {
    if (!UUID_PATTERN.test(apiId)) {
        throw new RequestHistoryNotFoundError();
    }
    const history = await findOwnedApiRequestHistory(
        userId,
        apiId,
        filters,
    );
    if (!history) {
        throw new RequestHistoryNotFoundError();
    }
    return history;
}

export async function getUserRequestHistoryRecord(
    userId: string,
    requestId: string,
) {
    if (!UUID_PATTERN.test(requestId)) {
        throw new RequestHistoryNotFoundError();
    }
    const record = await findOwnedRequestHistoryRecord(userId, requestId);
    if (!record) {
        throw new RequestHistoryNotFoundError();
    }
    return record;
}
