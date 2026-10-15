import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    buildMonitoringTimeSeries,
    buildMonitoringSummary,
    MonitoringValidationError,
    validateMonitoringDateRange,
    validateMonitoringTimeSeriesRange,
} from '../src/monitoring/monitoring-service.js';

test('summarizes totals, per-status counts, latency and an all-request error rate', () => {
    const summary = buildMonitoringSummary(
        'api-1',
        {
            from: new Date('2026-01-01T00:00:00.000Z'),
            to: new Date('2026-01-02T00:00:00.000Z'),
        },
        [
            {
                status_code: 200,
                request_count: '2',
                latency_count: '2',
                average_latency: '10',
            },
            {
                status_code: 404,
                request_count: '1',
                latency_count: '1',
                average_latency: '20',
            },
            {
                status_code: 500,
                request_count: '1',
                latency_count: '1',
                average_latency: '100',
            },
        ],
    );

    assert.deepEqual(summary, {
        apiId: 'api-1',
        period: {
            from: '2026-01-01T00:00:00.000Z',
            to: '2026-01-02T00:00:00.000Z',
        },
        totalRequests: 4,
        statusCodeCounts: { '200': 2, '404': 1, '500': 1 },
        averageLatencyMs: 35,
        errorCount: 2,
        errorRate: 0.5,
    });
});

test('returns zero counts and an undefined average for an empty time range', () => {
    assert.deepEqual(
        buildMonitoringSummary('api-1', {}, []),
        {
            apiId: 'api-1',
            period: { from: null, to: null },
            totalRequests: 0,
            statusCodeCounts: {},
            averageLatencyMs: null,
            errorCount: 0,
            errorRate: 0,
        },
    );
});

test('validates monitoring date ranges and rejects unsupported filters', () => {
    assert.deepEqual(
        validateMonitoringDateRange({
            from: '2026-01-01T00:00:00.000Z',
        }),
        { from: new Date('2026-01-01T00:00:00.000Z'), to: undefined },
    );

    for (const query of [
        { from: 'not-a-date' },
        { from: '2026-02-01', to: '2026-01-01' },
        { statusCode: '500' },
        { from: ['2026-01-01'] },
    ]) {
        assert.throws(
            () => validateMonitoringDateRange(query),
            MonitoringValidationError,
        );
    }
});

test('validates bounded time-series ranges and chooses bucket widths', () => {
    assert.equal(
        validateMonitoringTimeSeriesRange({
            from: '2026-01-01T00:00:00.000Z',
            to: '2026-01-02T00:00:00.000Z',
        }).bucketSize,
        'hour',
    );
    assert.equal(
        validateMonitoringTimeSeriesRange({
            from: '2026-01-01T00:00:00.000Z',
            to: '2026-01-04T00:00:00.000Z',
        }).bucketSize,
        'day',
    );
    assert.equal(
        validateMonitoringTimeSeriesRange({
            from: '2026-01-01T00:00:00.000Z',
            to: '2026-04-01T00:00:00.000Z',
        }).bucketSize,
        'day',
    );

    for (const query of [
        { from: '2026-01-01T00:00:00.000Z' },
        {
            from: '2026-01-01T00:00:00.000Z',
            to: '2026-04-02T00:00:00.000Z',
        },
    ]) {
        assert.throws(
            () => validateMonitoringTimeSeriesRange(query),
            MonitoringValidationError,
        );
    }
});

test('maps response classes, unknown statuses, latency, and empty buckets', () => {
    const range = validateMonitoringTimeSeriesRange({
        from: '2026-01-01T00:15:00.000Z',
        to: '2026-01-01T02:00:00.000Z',
    });
    const series = buildMonitoringTimeSeries('api-1', range, [
        {
            bucket_start: '2026-01-01T00:00:00.000Z',
            request_count: '4',
            informational_count: '0',
            successful_count: '2',
            redirection_count: '1',
            client_error_count: '1',
            server_error_count: '0',
            other_count: '0',
            latency_count: '4',
            average_latency: '25',
        },
        {
            bucket_start: '2026-01-01T01:00:00.000Z',
            request_count: '2',
            informational_count: '1',
            successful_count: '0',
            redirection_count: '0',
            client_error_count: '0',
            server_error_count: '1',
            other_count: '0',
            latency_count: '1',
            average_latency: '100',
        },
    ]);

    assert.equal(series.bucketSize, 'hour');
    assert.deepEqual(
        series.buckets.map((bucket) => ({
            bucketStart: bucket.bucketStart,
            requestCount: bucket.requestCount,
            statusCounts: bucket.statusCounts,
            latencyCount: bucket.latencyCount,
            averageLatencyMs: bucket.averageLatencyMs,
        })),
        [
            {
                bucketStart: '2026-01-01T00:00:00.000Z',
                requestCount: 4,
                statusCounts: {
                    informational: 0,
                    successful: 2,
                    redirection: 1,
                    clientError: 1,
                    serverError: 0,
                    other: 0,
                },
                latencyCount: 4,
                averageLatencyMs: 25,
            },
            {
                bucketStart: '2026-01-01T01:00:00.000Z',
                requestCount: 2,
                statusCounts: {
                    informational: 1,
                    successful: 0,
                    redirection: 0,
                    clientError: 0,
                    serverError: 1,
                    other: 0,
                },
                latencyCount: 1,
                averageLatencyMs: 100,
            },
            {
                bucketStart: '2026-01-01T02:00:00.000Z',
                requestCount: 0,
                statusCounts: {
                    informational: 0,
                    successful: 0,
                    redirection: 0,
                    clientError: 0,
                    serverError: 0,
                    other: 0,
                },
                latencyCount: 0,
                averageLatencyMs: null,
            },
        ],
    );
});

test('zero-fills every bounded bucket when the dataset is empty', () => {
    const range = validateMonitoringTimeSeriesRange({
        from: '2026-01-01T00:15:00.000Z',
        to: '2026-01-01T01:15:00.000Z',
    });
    const series = buildMonitoringTimeSeries('api-1', range, []);

    assert.deepEqual(
        series.buckets.map(({ requestCount, latencyCount, averageLatencyMs }) => ({
            requestCount,
            latencyCount,
            averageLatencyMs,
        })),
        [
            { requestCount: 0, latencyCount: 0, averageLatencyMs: null },
            { requestCount: 0, latencyCount: 0, averageLatencyMs: null },
        ],
    );
});
