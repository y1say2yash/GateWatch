import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, mock, test } from 'node:test';

import database from '../src/config/database.js';
import { createApi } from '../src/apis/api-repository.js';
import apiRoutes from '../src/apis/api-routes.js';
import gatewayRoutes from '../src/gateway/gateway-routes.js';
import {
    findOwnedApiRequestHistory,
    findOwnedRequestHistoryRecord,
    recordGatewayRequest,
} from '../src/request-history/request-history-repository.js';
import {
    RequestHistoryValidationError,
    validateRequestHistoryFilters,
} from '../src/request-history/request-history-service.js';
import {
    getUserApiMonitoringSummary,
    getUserApiMonitoringTimeSeries,
    MonitoringApiNotFoundError,
    validateMonitoringTimeSeriesRange,
} from '../src/monitoring/monitoring-service.js';
import { nextTestGithubId } from './test-user-identity.js';

let ownerId: string;
let otherUserId: string;
let projectId: string;
let apiId: string;
let routeId: string;
let projectSlug: string;
let upstream: Server;
let gateway: Server;
let management: Server;
let gatewayPort: number;
let upstreamPort: number;
const priorNodeEnv = process.env.NODE_ENV;
const priorAllowedOrigins = process.env.TEST_LOCAL_ALLOWED_ORIGINS;

function listen(server: Server): Promise<number> {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            resolve((server.address() as AddressInfo).port);
        });
    });
}

function getGatewayResponse(
    path: string,
    headers: Record<string, string>,
): Promise<{
    statusCode: number;
    requestId: string | undefined;
    body: string;
}> {
    return new Promise((resolve, reject) => {
        const outgoing = httpRequest(
            {
                host: '127.0.0.1',
                port: gatewayPort,
                path,
                method: 'GET',
                headers,
            },
            (response) => {
                let body = '';
                response.setEncoding('utf8');
                response.on('data', (chunk: string) => {
                    body += chunk;
                });
                response.on('end', () => {
                    resolve({
                        statusCode: response.statusCode ?? 0,
                        requestId: response.headers['x-request-id'],
                        body,
                    });
                });
            },
        );
        outgoing.on('error', reject);
        outgoing.end();
    });
}

before(async () => {
    upstream = createServer((_request, response) => {
        response.writeHead(201, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ secret: 'upstream-response-secret' }));
    });
    upstreamPort = await listen(upstream);
    process.env.NODE_ENV = 'test';
    process.env.TEST_LOCAL_ALLOWED_ORIGINS = `http://127.0.0.1:${upstreamPort}`;

    const app = express();
    app.use(gatewayRoutes);
    gateway = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => gateway.once('listening', resolve));
    gatewayPort = (gateway.address() as AddressInfo).port;

    const managementApp = express();
    managementApp.use('/api/v1', apiRoutes);
    management = managementApp.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => management.once('listening', resolve));

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const [owner] = await database<{ id: string }>('users')
        .insert({
            github_id: nextTestGithubId(),
            github_username: `history-owner-${suffix}`,
        })
        .returning('id');
    ownerId = owner.id;

    const [otherUser] = await database<{ id: string }>('users')
        .insert({
            github_id: nextTestGithubId(),
            github_username: `history-other-${suffix}`,
        })
        .returning('id');
    otherUserId = otherUser.id;

    const [project] = await database<{ id: string; slug: string }>('projects')
        .insert({
            user_id: ownerId,
            name: `History test ${suffix}`,
            slug: `history-test-${suffix}`,
        })
        .returning(['id', 'slug']);
    projectId = project.id;
    projectSlug = project.slug;

    const api = await createApi(projectId, {
        name: `History API ${suffix}`,
        upstreamUrl: `http://127.0.0.1:${upstreamPort}`,
    });
    apiId = api.id;
    await database('rate_limit_configs')
        .where({ api_id: apiId })
        .update({ enabled: false });

    const [route] = await database<{ id: string }>('api_routes')
        .insert({
            api_id: apiId,
            project_id: projectId,
            path_prefix: '/',
            method: 'GET',
        })
        .returning('id');
    routeId = route.id;
});

after(async () => {
    if (management) {
        await new Promise<void>((resolve) => management.close(() => resolve()));
    }
    if (gateway) {
        await new Promise<void>((resolve) => gateway.close(() => resolve()));
    }
    if (upstream) {
        await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
    if (ownerId) {
        await database('users').where({ id: ownerId }).delete();
    }
    if (otherUserId) {
        await database('users').where({ id: otherUserId }).delete();
    }
    await database.destroy();
    if (priorNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = priorNodeEnv;
    if (priorAllowedOrigins === undefined) delete process.env.TEST_LOCAL_ALLOWED_ORIGINS;
    else process.env.TEST_LOCAL_ALLOWED_ORIGINS = priorAllowedOrigins;
});

test('records upstream responses without request or response secrets', async () => {
    const response = await getGatewayResponse(
        `/p/${projectSlug}/hello?token=query-secret`,
        {
            authorization: 'Bearer authorization-secret',
            'x-api-key': 'sensitive-api-key',
        },
    );

    assert.equal(response.statusCode, 201);
    assert.ok(response.requestId);
    assert.match(response.body, /upstream-response-secret/);

    const history = await findOwnedRequestHistoryRecord(
        ownerId,
        response.requestId as string,
    );
    assert.ok(history);
    assert.equal(history.apiId, apiId);
    assert.equal(history.routeId, routeId);
    assert.equal(history.method, 'GET');
    assert.equal(history.path, '/hello');
    assert.equal(history.statusCode, 201);
    assert.equal(history.result?.source, 'upstream');
    assert.ok(history.latencyMs >= 0);

    const serialized = JSON.stringify(history);
    for (const secret of [
        'query-secret',
        'authorization-secret',
        'sensitive-api-key',
        'upstream-response-secret',
    ]) {
        assert.equal(serialized.includes(secret), false);
    }

    const hiddenFromOtherOwner = await findOwnedRequestHistoryRecord(
        otherUserId,
        response.requestId as string,
    );
    assert.equal(hiddenFromOtherOwner, null);
});

test('records gateway-generated authentication failures', async () => {
    await database('apis')
        .where({ id: apiId })
        .update({ auth_required: true });

    const response = await getGatewayResponse(
        `/p/${projectSlug}/protected`,
        { 'x-api-key': 'invalid-sensitive-key' },
    );

    assert.equal(response.statusCode, 401);
    assert.ok(response.requestId);
    const history = await findOwnedRequestHistoryRecord(
        ownerId,
        response.requestId as string,
    );
    assert.ok(history);
    assert.equal(history.result?.errorCode, 'INVALID_API_KEY');
    assert.equal(
        JSON.stringify(history).includes('invalid-sensitive-key'),
        false,
    );
});

test('history persistence failure does not alter the gateway response', async () => {
    await database('apis')
        .where({ id: apiId })
        .update({ auth_required: false });

    const originalQuery = database.client.query.bind(database.client);
    const queryStub = mock.method(
        database.client,
        'query',
        async (connection, queryConfig) => {
            if (queryConfig.sql.includes('"request_history"')) {
                throw new Error('simulated history persistence failure');
            }
            return originalQuery(connection, queryConfig);
        },
    );

    try {
        const response = await getGatewayResponse(
            `/p/${projectSlug}/history-write-failure`,
            {},
        );

        assert.equal(response.statusCode, 201);
        assert.ok(response.requestId);
        assert.match(response.body, /upstream-response-secret/);
    } finally {
        queryStub.mock.restore();
    }
});

test('paginates and filters history while enforcing owner and query validation', async () => {
    await Promise.all(
        [400, 503].map((statusCode) =>
            recordGatewayRequest({
                requestId: randomUUID(),
                apiId,
                routeId,
                method: 'GET',
                path: '/filtered',
                statusCode,
                latencyMs: 3,
                clientIdentity: 'ip:127.0.0.1',
                timestamp: new Date(),
                result: { source: 'gateway', errorCode: 'TEST' },
            }),
        ),
    );

    const filters = validateRequestHistoryFilters({
        page: '1',
        limit: '1',
        statusCode: '400',
        method: 'GET',
        sort: 'timestamp',
        order: 'desc',
    });

    const history = await findOwnedApiRequestHistory(ownerId, apiId, filters);
    assert.ok(history);
    assert.equal(history.data.length, 1);
    assert.equal(history.data[0].statusCode, 400);
    assert.equal(history.total, 1);

    assert.equal(
        await findOwnedApiRequestHistory(otherUserId, apiId, filters),
        null,
    );
    assert.throws(
        () => validateRequestHistoryFilters({ limit: '101' }),
        RequestHistoryValidationError,
    );
    assert.throws(
        () => validateRequestHistoryFilters({ statusCode: '99' }),
        RequestHistoryValidationError,
    );
    assert.throws(
        () => validateRequestHistoryFilters({ sort: 'path' }),
        RequestHistoryValidationError,
    );
    assert.throws(
        () => validateRequestHistoryFilters({ from: 'not-a-date' }),
        RequestHistoryValidationError,
    );
    assert.throws(
        () => validateRequestHistoryFilters({ unknown: 'value' }),
        RequestHistoryValidationError,
    );
});

test('aggregates monitoring statistics and handles an empty time range', async () => {
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-01-02T00:00:00.000Z');
    await Promise.all([
        recordGatewayRequest({
            requestId: randomUUID(),
            apiId,
            routeId,
            method: 'GET',
            path: '/ok',
            statusCode: 200,
            latencyMs: 10,
            clientIdentity: 'ip:127.0.0.1',
            timestamp: from,
            result: { source: 'upstream' },
        }),
        recordGatewayRequest({
            requestId: randomUUID(),
            apiId,
            routeId,
            method: 'GET',
            path: '/failure',
            statusCode: 503,
            latencyMs: 30,
            clientIdentity: 'ip:127.0.0.1',
            timestamp: to,
            result: { source: 'gateway', errorCode: 'UPSTREAM_TIMEOUT' },
        }),
    ]);

    const summary = await getUserApiMonitoringSummary(ownerId, apiId, {
        from,
        to,
    });
    assert.equal(summary.totalRequests, 2);
    assert.deepEqual(summary.statusCodeCounts, { '200': 1, '503': 1 });
    assert.equal(summary.averageLatencyMs, 20);
    assert.equal(summary.errorCount, 1);
    assert.equal(summary.errorRate, 0.5);

    const empty = await getUserApiMonitoringSummary(ownerId, apiId, {
        from: new Date('2035-01-01T00:00:00.000Z'),
        to: new Date('2035-01-02T00:00:00.000Z'),
    });
    assert.equal(empty.totalRequests, 0);
    assert.deepEqual(empty.statusCodeCounts, {});
    assert.equal(empty.averageLatencyMs, null);
    assert.equal(empty.errorRate, 0);

    await assert.rejects(
        getUserApiMonitoringSummary(otherUserId, apiId, {}),
        MonitoringApiNotFoundError,
    );
});

test('aggregates bounded monitoring time series and enforces API ownership', async () => {
    const from = new Date('2026-02-01T00:10:00.000Z');
    const to = new Date('2026-02-01T02:00:00.000Z');
    const records = [
        { statusCode: 200, latencyMs: 10, timestamp: '2026-02-01T00:15:00.000Z' },
        { statusCode: 200, latencyMs: 30, timestamp: '2026-02-01T00:20:00.000Z' },
        { statusCode: 302, latencyMs: 20, timestamp: '2026-02-01T00:30:00.000Z' },
        { statusCode: 404, latencyMs: 40, timestamp: '2026-02-01T00:40:00.000Z' },
        { statusCode: 500, latencyMs: 100, timestamp: '2026-02-01T01:10:00.000Z' },
        { statusCode: 600, latencyMs: 200, timestamp: '2026-02-01T01:20:00.000Z' },
        { statusCode: 100, latencyMs: 300, timestamp: '2026-02-01T01:30:00.000Z' },
    ];
    await Promise.all(records.map((record) =>
        recordGatewayRequest({
            requestId: randomUUID(),
            apiId,
            routeId,
            method: 'GET',
            path: '/series',
            statusCode: record.statusCode,
            latencyMs: record.latencyMs,
            clientIdentity: null,
            timestamp: new Date(record.timestamp),
            result: { source: 'upstream' },
        }),
    ));

    const range = validateMonitoringTimeSeriesRange({
        from: from.toISOString(),
        to: to.toISOString(),
    });
    const series = await getUserApiMonitoringTimeSeries(ownerId, apiId, range);
    assert.equal(series.bucketSize, 'hour');
    assert.equal(series.buckets.length, 3);
    assert.deepEqual(series.buckets[0], {
        bucketStart: '2026-02-01T00:00:00.000Z',
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
    });
    assert.deepEqual(series.buckets[1]?.statusCounts, {
        informational: 1,
        successful: 0,
        redirection: 0,
        clientError: 0,
        serverError: 1,
        other: 1,
    });
    assert.equal(series.buckets[1]?.requestCount, 3);
    assert.equal(series.buckets[1]?.averageLatencyMs, 200);
    assert.equal(series.buckets[2]?.requestCount, 0);
    assert.equal(series.buckets[2]?.averageLatencyMs, null);

    await assert.rejects(
        getUserApiMonitoringTimeSeries(otherUserId, apiId, range),
        MonitoringApiNotFoundError,
    );
});

test('requires an authenticated session for the time-series endpoint', async () => {
    const address = management.address() as AddressInfo;
    const response = await fetch(
        `http://127.0.0.1:${address.port}/api/v1/apis/${apiId}/monitoring/timeseries?from=2026-02-01T00:00:00.000Z&to=2026-02-01T01:00:00.000Z`,
    );

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
        error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Authentication is required.',
        },
    });
});
