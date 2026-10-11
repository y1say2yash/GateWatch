import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    buildMonitoringSummary,
    MonitoringValidationError,
    validateMonitoringDateRange,
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
