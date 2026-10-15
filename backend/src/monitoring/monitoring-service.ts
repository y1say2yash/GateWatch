import {
    findOwnedApiMonitoringRows,
    findOwnedApiMonitoringTimeSeriesRows,
} from './monitoring-repository.js';
import type {
    MonitoringBucketSize,
    MonitoringDateRange,
    MonitoringStatusRow,
    MonitoringSummary,
    MonitoringTimeSeries,
    MonitoringTimeSeriesPoint,
    MonitoringTimeSeriesRow,
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
const MAX_TIME_SERIES_RANGE_MS = 90 * 24 * 60 * 60 * 1_000;
const HOURLY_BUCKET_MAX_RANGE_MS = 48 * 60 * 60 * 1_000;
const TIME_SERIES_BUCKET_LIMIT = 92;
const BUCKET_INTERVAL_MS: Record<MonitoringBucketSize, number> = {
    hour: 60 * 60 * 1_000,
    day: 24 * 60 * 60 * 1_000,
};
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

export interface MonitoringTimeSeriesRange extends Required<MonitoringDateRange> {
    bucketSize: MonitoringBucketSize;
}

export function validateMonitoringTimeSeriesRange(
    query: Record<string, unknown>,
): MonitoringTimeSeriesRange {
    const range = validateMonitoringDateRange(query);
    if (!range.from || !range.to) {
        throw new MonitoringValidationError(
            'from and to are required for monitoring time series.',
        );
    }

    const rangeMs = range.to.getTime() - range.from.getTime();
    if (rangeMs > MAX_TIME_SERIES_RANGE_MS) {
        throw new MonitoringValidationError(
            'Monitoring time series are limited to a 90-day range.',
        );
    }

    const bucketSize = rangeMs <= HOURLY_BUCKET_MAX_RANGE_MS ? 'hour' : 'day';
    const firstBucket = Math.floor(range.from.getTime() / BUCKET_INTERVAL_MS[bucketSize]);
    const lastBucket = Math.floor(range.to.getTime() / BUCKET_INTERVAL_MS[bucketSize]);
    if (lastBucket - firstBucket + 1 > TIME_SERIES_BUCKET_LIMIT) {
        throw new MonitoringValidationError(
            'The requested monitoring time series contains too many buckets.',
        );
    }

    return { from: range.from, to: range.to, bucketSize };
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

function numericCount(value: string | number): number {
    return Number(value);
}

export function buildMonitoringTimeSeries(
    apiId: string,
    range: MonitoringTimeSeriesRange,
    rows: MonitoringTimeSeriesRow[],
): MonitoringTimeSeries {
    const bucketIntervalMs = BUCKET_INTERVAL_MS[range.bucketSize];
    const firstBucket = Math.floor(range.from.getTime() / bucketIntervalMs) * bucketIntervalMs;
    const lastBucket = Math.floor(range.to.getTime() / bucketIntervalMs) * bucketIntervalMs;
    const rowsByBucket = new Map(
        rows.map((row) => [new Date(row.bucket_start).getTime(), row]),
    );
    const buckets: MonitoringTimeSeriesPoint[] = [];

    for (let bucketTime = firstBucket; bucketTime <= lastBucket; bucketTime += bucketIntervalMs) {
        const row = rowsByBucket.get(bucketTime);
        const latencyCount = row ? numericCount(row.latency_count) : 0;
        buckets.push({
            bucketStart: new Date(bucketTime).toISOString(),
            requestCount: row ? numericCount(row.request_count) : 0,
            statusCounts: {
                informational: row ? numericCount(row.informational_count) : 0,
                successful: row ? numericCount(row.successful_count) : 0,
                redirection: row ? numericCount(row.redirection_count) : 0,
                clientError: row ? numericCount(row.client_error_count) : 0,
                serverError: row ? numericCount(row.server_error_count) : 0,
                other: row ? numericCount(row.other_count) : 0,
            },
            latencyCount,
            averageLatencyMs:
                row?.average_latency === null || row?.average_latency === undefined
                    ? null
                    : Number(row.average_latency),
        });
    }

    return {
        apiId,
        period: {
            from: range.from.toISOString(),
            to: range.to.toISOString(),
        },
        bucketSize: range.bucketSize,
        buckets,
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

export async function getUserApiMonitoringTimeSeries(
    userId: string,
    apiId: string,
    range: MonitoringTimeSeriesRange,
): Promise<MonitoringTimeSeries> {
    if (!UUID_PATTERN.test(apiId)) {
        throw new MonitoringApiNotFoundError();
    }
    const rows = await findOwnedApiMonitoringTimeSeriesRows(
        userId,
        apiId,
        range,
        range.bucketSize,
    );
    if (!rows) {
        throw new MonitoringApiNotFoundError();
    }
    return buildMonitoringTimeSeries(apiId, range, rows);
}
