import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    RequestHistoryValidationError,
    validateRequestHistoryFilters,
} from '../src/request-history/request-history-service.js';
import { sanitizeRequestHistoryPath } from '../src/request-history/request-history-repository.js';

test('validates supported request-history filters and defaults', () => {
    assert.deepEqual(
        validateRequestHistoryFilters({
            statusCode: '500',
            method: 'GET',
            from: '2026-01-01T00:00:00.000Z',
            to: '2026-01-02T00:00:00.000Z',
            sort: 'timestamp',
            order: 'asc',
        }),
        {
            page: 1,
            limit: 20,
            statusCode: 500,
            method: 'GET',
            from: new Date('2026-01-01T00:00:00.000Z'),
            to: new Date('2026-01-02T00:00:00.000Z'),
            sort: 'timestamp',
            order: 'asc',
        },
    );
});

test('rejects unsupported and invalid request-history query parameters', () => {
    const invalidQueries = [
        { limit: '101' },
        { page: '-1' },
        { statusCode: '99' },
        { method: 'TRACE' },
        { sort: 'path' },
        { order: 'newest' },
        { from: 'not-a-date' },
        { from: '2026-02-01', to: '2026-01-01' },
        { extra: 'value' },
        { limit: ['1', '2'] },
    ];

    for (const query of invalidQueries) {
        assert.throws(
            () => validateRequestHistoryFilters(query),
            RequestHistoryValidationError,
        );
    }
});

test('redacts likely path tokens while preserving ordinary paths and UUIDs', () => {
    assert.equal(
        sanitizeRequestHistoryPath(
            '/users/token/a-sensitive-token/access_token=another-secret',
        ),
        '/users/token/[REDACTED]/access_token=[REDACTED]',
    );
    assert.equal(
        sanitizeRequestHistoryPath(
            '/users/550e8400-e29b-41d4-a716-446655440000',
        ),
        '/users/550e8400-e29b-41d4-a716-446655440000',
    );
    assert.equal(sanitizeRequestHistoryPath('/users/current'), '/users/current');
});
