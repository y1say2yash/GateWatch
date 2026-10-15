import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Request, Response } from 'express';
import { after, before, test } from 'node:test';

import database from '../src/config/database.js';
import {
    createApi,
} from '../src/apis/api-repository.js';
import { classifyHealthCheck } from '../src/health/health-classification.js';
import {
    findOwnedHealthCheckConfig,
    findScheduledHealthChecks,
    updateOwnedHealthCheckConfig,
} from '../src/health/health-config-repository.js';
import {
    findOwnedHealthHistory,
    findOwnedHealthStatus,
    persistHealthCheck,
} from '../src/health/health-repository.js';
import {
    HealthApiNotFoundError,
    HealthCheckAlreadyRunningError,
    runUserHealthCheck,
    getUserHealthCheckConfig,
    getNextHealthCheckDelay,
    isScheduledHealthCheckDue,
} from '../src/health/health-service.js';
import {
    getApiHealthConfigController,
    patchApiHealthConfigController,
} from '../src/health/health-controller.js';
import {
    HealthConfigValidationError,
    validateCombinedStatusRange,
    validateHealthConfigUpdate,
} from '../src/health/health-validation.js';

import type { HealthCheckConfig } from '../src/health/health-types.js';
import { nextTestGithubId } from './test-user-identity.js';

const defaultConfig: HealthCheckConfig = {
    apiId: 'api-1',
    enabled: true,
    path: '/',
    intervalSeconds: 60,
    timeoutMs: 5_000,
    expectedStatusMin: 200,
    expectedStatusMax: 299,
    latencyThresholdMs: 1_000,
};

let ownerId: string;
let otherUserId: string;
let apiId: string;
let server: ReturnType<typeof createServer>;
let serverPort: number;
let releaseHeldResponse: ServerResponse | null = null;
let onHeldRequest: (() => void) | null = null;
let timeoutRequestCount = 0;
let onTimeoutRetries: (() => void) | null = null;
const priorNodeEnv = process.env.NODE_ENV;
const priorAllowedOrigins = process.env.TEST_LOCAL_ALLOWED_ORIGINS;

before(async () => {
    server = createServer((request, response) => {
        if (request.url === '/timeout') {
            timeoutRequestCount += 1;
            if (timeoutRequestCount === 2) {
                onTimeoutRetries?.();
            }
            return;
        }

        if (request.url === '/hold') {
            releaseHeldResponse = response;
            onHeldRequest?.();
            return;
        }

        response.writeHead(200);
        response.end();
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    serverPort = (server.address() as AddressInfo).port;
    process.env.NODE_ENV = 'test';
    process.env.TEST_LOCAL_ALLOWED_ORIGINS = `http://127.0.0.1:${serverPort}`;

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const [owner] = await database<{ id: string }>('users')
        .insert({
            github_id: nextTestGithubId(),
            github_username: `health-owner-${suffix}`,
        })
        .returning('id');
    ownerId = owner.id;

    const [otherUser] = await database<{ id: string }>('users')
        .insert({
            github_id: nextTestGithubId(),
            github_username: `health-other-${suffix}`,
        })
        .returning('id');
    otherUserId = otherUser.id;

    const [project] = await database<{ id: string }>('projects')
        .insert({
            user_id: ownerId,
            name: `Health test ${suffix}`,
            slug: `health-test-${suffix}`,
        })
        .returning('id');

    const api = await createApi(project.id, {
        name: `Health API ${suffix}`,
        upstreamUrl: `http://127.0.0.1:${serverPort}`,
    });
    apiId = api.id;
    await database('apis')
        .where({ id: apiId })
        .update({ status: 'ACTIVE' });
});

after(async () => {
    if (releaseHeldResponse) {
        releaseHeldResponse.destroy();
    }

    if (server) {
        await new Promise<void>((resolve) => {
            server.close(() => resolve());
        });
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

test('classifies an expected, timely response as healthy', () => {
    assert.equal(
        classifyHealthCheck(200, 500, 1, defaultConfig),
        'HEALTHY',
    );
});

test('classifies a timed-out check as down after the retry', () => {
    assert.equal(
        classifyHealthCheck(null, 10_000, 2, defaultConfig),
        'DOWN',
    );
});

test('classifies a slow expected response as degraded', () => {
    assert.equal(
        classifyHealthCheck(204, 1_001, 1, defaultConfig),
        'DEGRADED',
    );
});

test('classifies a recovered retry as degraded', () => {
    assert.equal(
        classifyHealthCheck(200, 700, 2, defaultConfig),
        'DEGRADED',
    );
});

test('classifies a response outside the expected range as down', () => {
    assert.equal(
        classifyHealthCheck(503, 100, 2, defaultConfig),
        'DOWN',
    );
});

test('accepts partial health configuration changes', () => {
    assert.deepEqual(
        validateHealthConfigUpdate({ enabled: false, path: '/ready' }),
        { enabled: false, path: '/ready' },
    );
});

test('rejects unsupported health configuration fields', () => {
    assert.throws(
        () => validateHealthConfigUpdate({ secret: 'value' }),
        HealthConfigValidationError,
    );
});

test('rejects invalid health configuration field types', () => {
    assert.throws(
        () => validateHealthConfigUpdate({ enabled: 'false' }),
        HealthConfigValidationError,
    );
    assert.throws(
        () => validateHealthConfigUpdate({ timeoutMs: '5000' }),
        HealthConfigValidationError,
    );
});

test('rejects a combined expected-status range with minimum above maximum', () => {
    assert.throws(
        () =>
            validateCombinedStatusRange(defaultConfig, {
                expectedStatusMin: 500,
            }),
        HealthConfigValidationError,
    );
});

test('schedules configured intervals below one minute without fixed-tick delay', () => {
    const baseTime = Date.UTC(2026, 0, 1);
    const shortIntervalCheck = {
        target: {
            id: 'short-interval-api',
            upstreamUrl: 'http://127.0.0.1',
            upstreamBasePath: null,
            status: 'ACTIVE',
            healthStatus: 'HEALTHY' as const,
            lastHealthCheckAt: new Date(baseTime),
        },
        config: {
            ...defaultConfig,
            apiId: 'short-interval-api',
            intervalSeconds: 5,
        },
    };
    const longIntervalCheck = {
        target: {
            ...shortIntervalCheck.target,
            id: 'long-interval-api',
            lastHealthCheckAt: new Date(baseTime),
        },
        config: {
            ...defaultConfig,
            apiId: 'long-interval-api',
            intervalSeconds: 30,
        },
    };

    assert.equal(
        isScheduledHealthCheckDue(shortIntervalCheck, baseTime + 4_999),
        false,
    );
    assert.equal(
        isScheduledHealthCheckDue(shortIntervalCheck, baseTime + 5_000),
        true,
    );
    assert.equal(
        getNextHealthCheckDelay(
            [shortIntervalCheck, longIntervalCheck],
            baseTime + 5_000,
            new Map([['short-interval-api', baseTime + 10_000]]),
        ),
        5_000,
    );
});

test('enforces ownership and returns not-found for an API owned by another user', async () => {
    const config = await findOwnedHealthCheckConfig(ownerId, apiId);
    assert.equal(config?.enabled, true);
    assert.equal(
        await findOwnedHealthCheckConfig(otherUserId, apiId),
        null,
    );
    await assert.rejects(
        getUserHealthCheckConfig(otherUserId, apiId),
        HealthApiNotFoundError,
    );
    assert.equal(await findOwnedHealthStatus(otherUserId, apiId), null);
});

test('live health schema matches the migration and repository column names', async () => {
    const columnResult: {
        rows: Array<{ table_name: string; column_name: string }>;
    } = await database.raw(`
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name IN ('apis', 'health_checks', 'health_check_configs')
    `);
    const columns = new Set(
        columnResult.rows.map(
            ({ table_name, column_name }) => `${table_name}.${column_name}`,
        ),
    );

    for (const column of [
        'apis.health_status',
        'apis.last_health_check_at',
        'health_checks.id',
        'health_checks.response_status',
        'health_checks.attempt_count',
        'health_checks.is_manual',
        'health_check_configs.path',
        'health_check_configs.expected_status_min',
    ]) {
        assert.equal(columns.has(column), true, `missing ${column}`);
    }

    assert.equal(columns.has('health_checks.http_status'), false);
    assert.equal(columns.has('health_checks.trigger_type'), false);
    assert.equal(columns.has('health_check_configs.configuration'), false);

    const enumResult: { rows: Array<{ label: string }> } =
        await database.raw(`
            SELECT unnest(enum_range(NULL::health_status))::text AS label
        `);
    assert.deepEqual(
        enumResult.rows.map(({ label }) => label),
        ['HEALTHY', 'DEGRADED', 'DOWN'],
    );
});

test('persists health state and returns bounded newest-first history', async () => {
    const checkedAt = new Date().toISOString();
    await persistHealthCheck({
        apiId,
        status: 'DEGRADED',
        responseTimeMs: 1_100,
        httpStatus: 200,
        attemptCount: 2,
        errorMessage: 'Retry succeeded after an initial failed attempt.',
        isManual: false,
        checkedAt,
    });

    const status = await findOwnedHealthStatus(ownerId, apiId);
    const history = await findOwnedHealthHistory(ownerId, apiId, 1);

    assert.equal(status?.healthStatus, 'DEGRADED');
    assert.equal(status?.lastHealthCheckAt, checkedAt);
    assert.equal(history?.length, 1);
    assert.equal(history?.[0].attemptCount, 2);
    assert.equal(history?.[0].httpStatus, 200);
    assert.equal(await findOwnedHealthHistory(otherUserId, apiId, 10), null);
});

test('scheduled query includes only active APIs with enabled health checks', async () => {
    const scheduled = await findScheduledHealthChecks();
    assert.equal(
        scheduled.some(({ target }) => target.id === apiId),
        true,
    );

    await updateOwnedHealthCheckConfig(ownerId, apiId, { enabled: false });
    const disabledSchedule = await findScheduledHealthChecks();
    assert.equal(
        disabledSchedule.some(({ target }) => target.id === apiId),
        false,
    );
    await updateOwnedHealthCheckConfig(ownerId, apiId, { enabled: true });
});

test('manual checks retry timed-out attempts and persist the outcome', async () => {
    timeoutRequestCount = 0;
    await updateOwnedHealthCheckConfig(ownerId, apiId, {
        path: '/timeout',
        timeoutMs: 50,
    });

    const timeoutRetries = new Promise<void>((resolve) => {
        onTimeoutRetries = resolve;
    });
    const checkPromise = runUserHealthCheck(ownerId, apiId);
    await timeoutRetries;
    const result = await checkPromise;

    assert.equal(result.status, 'DOWN');
    assert.equal(result.attemptCount, 2);
    assert.equal(result.httpStatus, null);
    assert.match(result.errorMessage ?? '', /timed out/);

    await updateOwnedHealthCheckConfig(ownerId, apiId, {
        path: '/',
        timeoutMs: 5_000,
    });
    onTimeoutRetries = null;
});

test('manual checks do not overlap for the same API', async () => {
    await updateOwnedHealthCheckConfig(ownerId, apiId, {
        path: '/hold',
        timeoutMs: 5_000,
    });

    const heldRequest = new Promise<void>((resolve) => {
        onHeldRequest = resolve;
    });
    const firstCheck = runUserHealthCheck(ownerId, apiId);
    await heldRequest;

    await assert.rejects(
        runUserHealthCheck(ownerId, apiId),
        HealthCheckAlreadyRunningError,
    );

    releaseHeldResponse?.writeHead(200);
    releaseHeldResponse?.end();
    await firstCheck;
    releaseHeldResponse = null;
    onHeldRequest = null;
    await updateOwnedHealthCheckConfig(ownerId, apiId, { path: '/' });
});

test('health configuration endpoint returns a structured validation error', async () => {
    let responseStatus = 0;
    let responseBody: unknown;
    const request = {
        params: { apiId },
        body: { timeoutMs: '5000' },
    } as Request<{ apiId: string }>;
    const response = {
        locals: { user: { id: ownerId } },
        status(status: number) {
            responseStatus = status;
            return this;
        },
        json(body: unknown) {
            responseBody = body;
            return this;
        },
    } as unknown as Response;

    await patchApiHealthConfigController(request, response);

    assert.equal(responseStatus, 400);
    assert.deepEqual(responseBody, {
        error: {
            code: 'INVALID_HEALTH_CHECK_CONFIG',
            message: 'timeoutMs must be an integer between 1 and 5000.',
        },
    });
});

test('health configuration endpoint returns a structured not-found error for non-owners', async () => {
    let responseStatus = 0;
    let responseBody: unknown;
    const request = {
        params: { apiId },
    } as Request<{ apiId: string }>;
    const response = {
        locals: { user: { id: otherUserId } },
        status(status: number) {
            responseStatus = status;
            return this;
        },
        json(body: unknown) {
            responseBody = body;
            return this;
        },
    } as unknown as Response;

    await getApiHealthConfigController(request, response);

    assert.equal(responseStatus, 404);
    assert.deepEqual(responseBody, {
        error: {
            code: 'API_NOT_FOUND',
            message: 'API not found.',
        },
    });
});
