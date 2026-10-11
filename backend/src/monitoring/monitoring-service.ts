import { findOwnedApiMonitoringRows } from './monitoring-repository.js';
import type {
    MonitoringDateRange,
    MonitoringStatusRow,
    MonitoringSummary,
} from './monitoring-types.js';

export class MonitoringApiNotFoundError extends Error {
    constructor() {
        super('API not found.');
        this.name = 'MonitoringApiNotFoundError';
    }
}

export class MonitoringValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'MonitoringValidationError';
    }
}

const ALLOWED_QUERY_KEYS = new Set(['from', 'to']);
const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getQueryString(
    query: Record<string, unknown>,
    key: string,
): string | undefined {
    const value = query[key];
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== 'string') {
        throw new MonitoringValidationError(
            `${key} must be provided once as a string.`,
        );
    }
    return value;
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
        throw new MonitoringValidationError(
            `${key} must be a valid timestamp.`,
        );
    }
    return parsed;
}

export function validateMonitoringDateRange(
    query: Record<string, unknown>,
): MonitoringDateRange {
    for (const key of Object.keys(query)) {
        if (!ALLOWED_QUERY_KEYS.has(key)) {
            throw new MonitoringValidationError(
                `Unsupported monitoring query parameter: ${key}.`,
            );
        }
    }

    const from = parseDate(getQueryString(query, 'from'), 'from');
    const to = parseDate(getQueryString(query, 'to'), 'to');
    if (from && to && from > to) {
        throw new MonitoringValidationError(
            'from must be earlier than or equal to to.',
        );
    }
    return { from, to };
}

export function buildMonitoringSummary(
    apiId: string,
    range: MonitoringDateRange,
    rows: MonitoringStatusRow[],
): MonitoringSummary {
    const statusCodeCounts: Record<string, number> = {};
    let totalRequests = 0;
    let errorCount = 0;
    let latencyTotal = 0;
    let latencyCount = 0;

    for (const row of rows) {
        const count = Number(row.request_count ?? 0);
        const rowLatencyCount = Number(row.latency_count ?? 0);
        const averageLatency = row.average_latency === null
            ? null
            : Number(row.average_latency);

        statusCodeCounts[String(row.status_code)] = count;
        totalRequests += count;
        if (row.status_code >= 400) {
            errorCount += count;
        }
        if (averageLatency !== null && rowLatencyCount > 0) {
            latencyTotal += averageLatency * rowLatencyCount;
            latencyCount += rowLatencyCount;
        }
    }

    return {
        apiId,
        period: {
            from: range.from?.toISOString() ?? null,
            to: range.to?.toISOString() ?? null,
        },
        totalRequests,
        statusCodeCounts,
        averageLatencyMs: latencyCount === 0
            ? null
            : latencyTotal / latencyCount,
        errorCount,
        errorRate: totalRequests === 0 ? 0 : errorCount / totalRequests,
    };
}

export async function getUserApiMonitoringSummary(
    userId: string,
    apiId: string,
    range: MonitoringDateRange,
): Promise<MonitoringSummary> {
    if (!UUID_PATTERN.test(apiId)) {
        throw new MonitoringApiNotFoundError();
    }
    const rows = await findOwnedApiMonitoringRows(userId, apiId, range);
    if (!rows) {
        throw new MonitoringApiNotFoundError();
    }
    return buildMonitoringSummary(apiId, range, rows);
}
