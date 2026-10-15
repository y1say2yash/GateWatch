import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { after, before, test } from 'node:test';

import app from '../src/app.js';
import database from '../src/config/database.js';
import { protectAuthentication } from '../src/tests/test-credentials.js';
import { nextTestGithubId } from './test-user-identity.js';

let upstreamServer: Server | undefined;
let appServer: Server | undefined;
let upstreamOrigin: string;
let origin: string;
let ownerId: string | undefined;
let otherUserId: string | undefined;
const fixtureUserIds: string[] = [];
let apiId: string;
let ownerCookie: string;
let otherCookie: string;
let testId: string;
const priorNodeEnv = process.env.NODE_ENV;
const priorAllowedOrigins = process.env.TEST_LOCAL_ALLOWED_ORIGINS;
const priorCredentialKey = process.env.TEST_CREDENTIAL_ENCRYPTION_KEY;

function closeServer(server: Server | undefined): Promise<void> {
    if (!server?.listening) return Promise.resolve();
    return new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    });
}

async function createUser(): Promise<{ id: string; cookie: string }> {
    const suffix = crypto.randomUUID();
    const [user] = await database<{ id: string }>('users')
        .insert({
            github_id: nextTestGithubId(),
            github_username: `exec-${suffix}`,
            is_admin: false,
        })
        .returning('id');
    fixtureUserIds.push(user.id);
    const token = crypto.randomBytes(32).toString('hex');
    await database('sessions').insert({
        user_id: user.id,
        token_hash: crypto.createHash('sha256').update(token).digest('hex'),
        expires_at: new Date(Date.now() + 60_000),
    });
    return { id: user.id, cookie: `gatewatch_session=${token}` };
}

async function createAccessToken(
    userId: string,
    options: { expiresAt?: Date; revokedAt?: Date } = {},
): Promise<string> {
    const token = `gw_at_${crypto.randomBytes(32).toString('base64url')}`;
    await database('access_tokens').insert({
        user_id: userId,
        name: 'Execution test token',
        token_hash: crypto.createHash('sha256').update(token).digest('hex'),
        expires_at: options.expiresAt ?? null,
        revoked_at: options.revokedAt ?? null,
    });
    return token;
}

async function installAuditFailureTrigger(): Promise<() => Promise<void>> {
    const suffix = crypto.randomUUID().replaceAll('-', '');
    const functionName = `test_audit_fail_${suffix}`;
    const triggerName = `test_audit_fail_trigger_${suffix}`;
    await database.raw(`
        CREATE FUNCTION ${functionName}() RETURNS trigger AS $$
        BEGIN
            IF NEW.action IN ('TEST_EXECUTED', 'ACCESS_TOKEN_CREATED') THEN
                RAISE EXCEPTION 'test audit failure';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    `);
    await database.raw(`
        CREATE TRIGGER ${triggerName}
        BEFORE INSERT ON audit_logs
        FOR EACH ROW EXECUTE FUNCTION ${functionName}();
    `);
    return async () => {
        await database.raw(`DROP TRIGGER IF EXISTS ${triggerName} ON audit_logs`);
        await database.raw(`DROP FUNCTION IF EXISTS ${functionName}()`);
    };
}

async function createApi(userId: string, upstreamUrl: string): Promise<string> {
    const [project] = await database<{ id: string }>('projects')
        .insert({
            user_id: userId,
            name: `Exec project ${crypto.randomUUID()}`,
            slug: `exec-${crypto.randomUUID()}`,
        })
        .returning('id');
    const [api] = await database<{ id: string }>('apis')
        .insert({
            project_id: project.id,
            name: `Exec API ${crypto.randomUUID()}`,
            upstream_url: upstreamUrl,
            status: 'ACTIVE',
        })
        .returning('id');
    return api.id;
}

async function request(
    path: string,
    cookie?: string,
    init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
    const response = await fetch(`${origin}${path}`, {
        ...init,
        headers: {
            ...(cookie ? { Cookie: cookie } : {}),
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
            ...init.headers,
        },
    });
    return {
        status: response.status,
        body: response.status === 204 ? null : await response.json(),
    };
}

async function updateDefinition(
    path: string,
    assertions: unknown[],
    timeoutMs = 5_000,
): Promise<void> {
    await database('tests').where({ id: testId }).update({
        url: `${upstreamOrigin}${path}`,
        timeout_ms: timeoutMs,
        assertions: JSON.stringify(assertions),
    });
}

before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.TEST_CREDENTIAL_ENCRYPTION_KEY = 'b'.repeat(64);
    upstreamServer = createServer((request, response) => {
        if (request.url === '/slow') {
            const timer = setTimeout(() => {
                response.writeHead(200, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ status: 'ok' }));
            }, 200);
            response.on('close', () => clearTimeout(timer));
            return;
        }
        if (request.url === '/disconnect') {
            request.socket.destroy();
            return;
        }
        if (request.url === '/fail') {
            response.writeHead(503, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ error: 'service-down' }));
            return;
        }
        if (request.url === '/sensitive') {
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify({
                status: 'ok',
                profile: {
                    name: 'Test User',
                    password: 'must-not-be-stored',
                    nested: {
                        access_token: 'nested-secret',
                    },
                },
            }));
            return;
        }
        if (request.url === '/credentialed') {
            const authorized = request.headers.authorization === 'Bearer test-only-credential';
            response.writeHead(authorized ? 200 : 401, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ authorized }));
            return;
        }
        response.writeHead(200, {
            'content-type': 'application/json',
            'set-cookie': 'session=upstream-secret; HttpOnly',
        });
        response.end(JSON.stringify({ status: 'ok', items: [1, 2, 3] }));
    });
    await new Promise<void>((resolve) => upstreamServer?.listen(0, '127.0.0.1', resolve));
    upstreamOrigin = `http://127.0.0.1:${(upstreamServer.address() as AddressInfo).port}`;
    process.env.TEST_LOCAL_ALLOWED_ORIGINS = upstreamOrigin;

    appServer = app.listen(0, '127.0.0.1');
    await once(appServer, 'listening');
    origin = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`;

    const owner = await createUser();
    ownerId = owner.id;
    ownerCookie = owner.cookie;
    const other = await createUser();
    otherUserId = other.id;
    otherCookie = other.cookie;
    apiId = await createApi(ownerId, upstreamOrigin);

    const create = await request(`/api/v1/apis/${apiId}/tests`, ownerCookie, {
        method: 'POST',
        body: JSON.stringify({
            name: 'Exec health',
            method: 'GET',
            url: `${upstreamOrigin}/`,
            headers: { accept: 'application/json' },
            body: null,
            authentication: { type: 'NONE' },
            assertions: [
                { type: 'STATUS_CODE', operator: 'EQUALS', expected: 200 },
                { type: 'JSON_BODY', path: '/status', operator: 'EQUALS', expected: 'ok' },
                { type: 'RESPONSE_HEADER', name: 'content-type', operator: 'CONTAINS', expected: 'application/json' },
                { type: 'RESPONSE_TIME', operator: 'LESS_THAN_OR_EQUAL', expected: 1000 },
            ],
            timeoutMs: 5_000,
        }),
    });
    if (create.status !== 201) {
        throw new Error(
            `Test-definition setup failed with HTTP ${create.status}: ${JSON.stringify(create.body)}`,
        );
    }
    const createdTestId = (create.body as { data?: { id?: unknown } })?.data?.id;
    if (typeof createdTestId !== 'string') {
        throw new Error(
            `Test-definition setup returned HTTP ${create.status} without a test ID: ${JSON.stringify(create.body)}`,
        );
    }
    testId = createdTestId;
});

after(async () => {
    try {
        await Promise.all([
            closeServer(upstreamServer),
            closeServer(appServer),
        ]);
        const userIds = [...new Set(fixtureUserIds)];
        if (userIds.length > 0) {
            const projects = await database('projects').select('id').whereIn('user_id', userIds);
            const projectIds = projects.map(({ id }) => id);
            const apis = projectIds.length
                ? await database('apis').select('id').whereIn('project_id', projectIds)
                : [];
            const apiIds = apis.map(({ id }) => id);
            const tests = apiIds.length
                ? await database('tests').select('id').whereIn('api_id', apiIds)
                : [];
            const testIds = tests.map(({ id }) => id);
            if (testIds.length > 0) {
                await database('test_executions').whereIn('test_id', testIds).delete();
            }
            if (apiIds.length > 0) {
                await database('tests').whereIn('api_id', apiIds).delete();
            }
            if (projectIds.length > 0) {
                await database('apis').whereIn('project_id', projectIds).delete();
            }
            if (userIds.length > 0) {
                await database('projects').whereIn('user_id', userIds).delete();
            }
            await database('sessions').whereIn('user_id', userIds).delete();
            await database('audit_logs').whereIn('user_id', userIds).delete();
            await database('users').whereIn('id', userIds).delete();
        }
    } finally {
        await database.destroy();
        if (priorNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = priorNodeEnv;
        if (priorAllowedOrigins === undefined) delete process.env.TEST_LOCAL_ALLOWED_ORIGINS;
        else process.env.TEST_LOCAL_ALLOWED_ORIGINS = priorAllowedOrigins;
        if (priorCredentialKey === undefined) delete process.env.TEST_CREDENTIAL_ENCRYPTION_KEY;
        else process.env.TEST_CREDENTIAL_ENCRYPTION_KEY = priorCredentialKey;
    }
});

test('executes a successful test and persists safe manual execution metadata', async () => {
    const response = await request(`/api/v1/tests/${testId}/execute`, ownerCookie, { method: 'POST' });
    assert.equal(response.status, 200);
    const data = response.body as {
        data: {
            status: string;
            passed: boolean;
            durationMs: number;
            executionId: string;
            result: { assertions: unknown[] };
        };
    };
    assert.equal(data.data.status, 'PASSED');
    assert.equal(data.data.passed, true);
    assert.equal(data.data.result.assertions.length, 4);
    assert.equal(JSON.stringify(data.data.result).includes('upstream-secret'), false);

    const persisted = await database('test_executions')
        .where({ id: data.data.executionId })
        .first('status', 'trigger_type', 'duration_ms', 'result');
    assert.ok(persisted);
    assert.equal(persisted.status, 'PASSED');
    assert.equal(persisted.trigger_type, 'MANUAL');
    assert.equal(Number(persisted.duration_ms) >= 0, true);
    assert.equal(JSON.stringify(persisted.result).includes('upstream-secret'), false);

    const history = await request(
        `/api/v1/tests/${testId}/executions?limit=10`,
        ownerCookie,
    );
    assert.equal(history.status, 200);
    const historyData = history.body as {
        data: Array<{ id: string; status: string; testId: string }>;
    };
    assert.ok(historyData.data.some((item) =>
        item.id === data.data.executionId &&
        item.status === 'PASSED' &&
        item.testId === testId,
    ));
});

test('executes tests using encrypted bearer credentials', async () => {
    await updateDefinition('/credentialed', [
        { type: 'STATUS_CODE', operator: 'EQUALS', expected: 200 },
    ]);
    await database('tests')
        .where({ id: testId })
        .update({
            authentication: JSON.stringify(protectAuthentication({
                type: 'BEARER',
                token: 'test-only-credential',
            })),
        });

    const response = await request(`/api/v1/tests/${testId}/execute`, ownerCookie, { method: 'POST' });
    assert.equal(response.status, 200);
    const execution = response.body as {
        data: { status: string; executionId: string; result: unknown };
    };
    assert.equal(execution.data.status, 'PASSED');
    assert.equal(JSON.stringify(execution.data.result).includes('test-only-credential'), false);

    const stored = await database('tests').where({ id: testId }).first('authentication');
    assert.equal(JSON.stringify(stored.authentication).includes('test-only-credential'), false);
});

test('applies security headers without enabling permissive CORS', async () => {
    const response = await fetch(`${origin}/not-a-route`);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()');
    assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('records assertion failures as FAILED', async () => {
    await updateDefinition('/', [
        { type: 'JSON_BODY', path: '/status', operator: 'EQUALS', expected: 'broken' },
    ]);
    const response = await request(`/api/v1/tests/${testId}/execute`, ownerCookie, { method: 'POST' });
    assert.equal(response.status, 200);
    const data = response.body as {
        data: { status: string; passed: boolean; executionId: string; result: { assertions: { pass: boolean }[] } };
    };
    assert.equal(data.data.status, 'FAILED');
    assert.equal(data.data.passed, false);
    assert.equal(data.data.result.assertions[0].pass, false);
    const persisted = await database('test_executions')
        .where({ id: data.data.executionId })
        .first('status');
    assert.equal(persisted.status, 'FAILED');
});

test('evaluates a non-2xx HTTP response with status assertions', async () => {
    await updateDefinition('/fail', [
        { type: 'STATUS_CODE', operator: 'EQUALS', expected: 503 },
    ]);
    const response = await request(`/api/v1/tests/${testId}/execute`, ownerCookie, { method: 'POST' });
    assert.equal(response.status, 200);
    const data = response.body as { data: { status: string; result: { responseStatus: number } } };
    assert.equal(data.data.status, 'PASSED');
    assert.equal(data.data.result.responseStatus, 503);
});

test('rejects unauthorized execution without creating an execution record', async () => {
    const beforeCount = await database('test_executions').where({ test_id: testId }).count('* as count').first();
    const response = await request(`/api/v1/tests/${testId}/execute`, otherCookie, { method: 'POST' });
    const afterCount = await database('test_executions').where({ test_id: testId }).count('* as count').first();
    assert.equal(response.status, 404);
    assert.equal(afterCount?.count, beforeCount?.count);
});

test('persists upstream timeouts as ERROR', async () => {
    await updateDefinition('/slow', [], 50);
    const response = await request(`/api/v1/tests/${testId}/execute`, ownerCookie, { method: 'POST' });
    assert.equal(response.status, 200);
    const data = response.body as {
        data: { status: string; passed: boolean; executionId: string; result: { errorMessage?: string } };
    };
    assert.equal(data.data.status, 'ERROR');
    assert.equal(data.data.passed, false);
    assert.match(data.data.result.errorMessage ?? '', /timed out/i);
    const persisted = await database('test_executions')
        .where({ id: data.data.executionId })
        .first('status');
    assert.equal(persisted.status, 'ERROR');
});

test('persists connection failures as ERROR', async () => {
    await updateDefinition('/disconnect', []);
    const response = await request(`/api/v1/tests/${testId}/execute`, ownerCookie, { method: 'POST' });
    assert.equal(response.status, 200);
    const data = response.body as { data: { status: string; executionId: string } };
    assert.equal(data.data.status, 'ERROR');
    const persisted = await database('test_executions')
        .where({ id: data.data.executionId })
        .first('status');
    assert.equal(persisted.status, 'ERROR');
});

test('redacts sensitive fields from failed assertion summaries and persistence', async () => {
    await updateDefinition('/sensitive', [
        {
            type: 'JSON_BODY',
            path: '/profile',
            operator: 'EQUALS',
            expected: { name: 'Unexpected value' },
        },
    ]);

    const response = await request(
        `/api/v1/tests/${testId}/execute`,
        ownerCookie,
        { method: 'POST' },
    );

    assert.equal(response.status, 200);

    const data = response.body as {
        data: {
            executionId: string;
            result: unknown;
        };
    };

    const persisted = await database('test_executions')
        .where({ id: data.data.executionId })
        .first('result', 'assertions');

    const serialized = JSON.stringify({
        response: data.data.result,
        persisted: persisted?.result,
        persistedAssertions: persisted?.assertions,
    });

    assert.equal(serialized.includes('must-not-be-stored'), false);
    assert.equal(serialized.includes('nested-secret'), false);
    assert.equal(serialized.includes('[REDACTED]'), true);
});

test('serves owner-scoped paginated execution summaries without assertion values or response data', async () => {
    const before = await database('test_executions')
        .where({ test_id: testId })
        .count('* as count')
        .first();
    const baseCount = Number(before?.count ?? 0);
    const startedAt = Date.now();
    await database('test_executions').insert(
        [0, 1, 2].map((offset) => ({
            test_id: testId,
            status: 'FAILED',
            trigger_type: 'MANUAL',
            response_status: 503,
            response_time_ms: 42,
            assertions: JSON.stringify([{
                type: 'JSON_BODY',
                pass: false,
                expected: 'sensitive-expected-value',
                actual: 'sensitive-response-value',
                message: 'sensitive-assertion-message',
            }]),
            error_message: 'sensitive-upstream-error',
            started_at: new Date(startedAt + offset),
            completed_at: new Date(startedAt + offset + 1),
            duration_ms: 43,
            result: JSON.stringify({ responseBody: 'private-response-body' }),
        })),
    );

    const unauthenticated = await request(`/api/v1/tests/${testId}/executions?limit=2`);
    assert.equal(unauthenticated.status, 401);
    const notOwner = await request(
        `/api/v1/tests/${testId}/executions?limit=2`,
        otherCookie,
    );
    assert.equal(notOwner.status, 404);
    const invalidPage = await request(
        `/api/v1/tests/${testId}/executions?page=0`,
        ownerCookie,
    );
    assert.equal(invalidPage.status, 400);
    const invalidPageSize = await request(
        `/api/v1/tests/${testId}/executions?limit=101`,
        ownerCookie,
    );
    assert.equal(invalidPageSize.status, 400);

    const response = await request(
        `/api/v1/tests/${testId}/executions?page=1&limit=2`,
        ownerCookie,
    );
    assert.equal(response.status, 200);
    const payload = response.body as {
        data: Array<{
            testId: string;
            status: string;
            assertions: Array<{ type: string; pass: boolean }>;
        }>;
        pagination: { page: number; limit: number; total: number; totalPages: number };
    };
    assert.equal(payload.data.length, 2);
    assert.equal(payload.data[0]?.testId, testId);
    assert.deepEqual(payload.data[0]?.assertions, [{ type: 'JSON_BODY', pass: false }]);
    assert.deepEqual(payload.pagination, {
        page: 1,
        limit: 2,
        total: baseCount + 3,
        totalPages: Math.ceil((baseCount + 3) / 2),
    });
    const serialized = JSON.stringify(response.body);
    for (const secret of [
        'sensitive-expected-value',
        'sensitive-response-value',
        'sensitive-assertion-message',
        'sensitive-upstream-error',
        'private-response-body',
    ]) {
        assert.equal(serialized.includes(secret), false);
    }
});

test('does not interpolate expected values into failed array assertion messages', async () => {
    const expectedSentinel = 'private-expected-array-value';
    await updateDefinition('/', [
        {
            type: 'JSON_BODY',
            path: '/items',
            operator: 'CONTAINS',
            expected: expectedSentinel,
        },
    ]);

    const response = await request(
        `/api/v1/tests/${testId}/execute`,
        ownerCookie,
        { method: 'POST' },
    );
    assert.equal(response.status, 200);
    const data = response.body as {
        data: {
            executionId: string;
            result: { assertions: Array<{ message: string }> };
        };
    };
    const persisted = await database('test_executions')
        .where({ id: data.data.executionId })
        .first('assertions');
    const persistedAssertions = typeof persisted?.assertions === 'string'
        ? JSON.parse(persisted.assertions) as Array<{ message: string }>
        : persisted?.assertions as Array<{ message: string }>;

    assert.equal(
        data.data.result.assertions[0]?.message,
        'JSON path /items did not contain the expected member.',
    );
    assert.equal(
        persistedAssertions[0]?.message,
        'JSON path /items did not contain the expected member.',
    );
    assert.equal(persistedAssertions[0]?.message.includes(expectedSentinel), false);
});

test('creates, lists, and revokes access tokens without exposing stored hashes', async () => {
    const created = await request('/api/v1/users/me/access-tokens', ownerCookie, {
        method: 'POST',
        body: JSON.stringify({
            name: 'GitHub Actions',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }),
    });
    assert.equal(created.status, 201);
    const createdData = (created.body as {
        data: {
            accessToken: { id: string; name: string; expiresAt: string };
            token: string;
        };
    }).data;
    assert.equal(createdData.accessToken.name, 'GitHub Actions');
    assert.ok(createdData.accessToken.expiresAt);
    assert.match(createdData.token, /^gw_at_[A-Za-z0-9_-]+$/);

    const stored = await database('access_tokens')
        .where({ id: createdData.accessToken.id })
        .first('token_hash');
    assert.notEqual(stored?.token_hash, createdData.token);
    assert.equal(
        stored?.token_hash,
        crypto.createHash('sha256').update(createdData.token).digest('hex'),
    );

    const listed = await request('/api/v1/users/me/access-tokens', ownerCookie);
    assert.equal(listed.status, 200);
    assert.equal(JSON.stringify(listed.body).includes(createdData.token), false);
    assert.equal(JSON.stringify(listed.body).includes('token_hash'), false);

    const revoked = await request(
        `/api/v1/access-tokens/${createdData.accessToken.id}`,
        ownerCookie,
        { method: 'DELETE' },
    );
    assert.equal(revoked.status, 204);
    const rejected = await request(`/api/v1/tests/${testId}/execute`, undefined, {
        method: 'POST',
        headers: { Authorization: `Bearer ${createdData.token}` },
    });
    assert.equal(rejected.status, 401);
});

test('executes a saved test with an access token and records a safe CI/CD result', async () => {
    await updateDefinition('/', [
        { type: 'STATUS_CODE', operator: 'EQUALS', expected: 200 },
        { type: 'JSON_BODY', path: '/status', operator: 'EQUALS', expected: 'ok' },
    ]);
    const token = await createAccessToken(ownerId as string);
    const response = await request(`/api/v1/tests/${testId}/execute`, undefined, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId: otherUserId }),
    });
    assert.equal(response.status, 200);
    const data = (response.body as {
        data: {
            executionId: string;
            status: string;
            passed: boolean;
            result: { assertions: { pass: boolean }[] };
        };
    }).data;
    assert.equal(data.status, 'PASSED');
    assert.equal(data.passed, true);
    assert.equal(data.result.assertions.length, 2);
    assert.ok(data.result.assertions.every((assertion) => assertion.pass));

    const persisted = await database('test_executions')
        .where({ id: data.executionId })
        .first('trigger_type', 'result');
    assert.equal(persisted?.trigger_type, 'CI_CD');
    assert.equal(JSON.stringify(persisted?.result).includes(token), false);
});

test('rejects missing, invalid, revoked, and expired access tokens', async () => {
    const expiredToken = await createAccessToken(ownerId as string, {
        expiresAt: new Date(Date.now() - 1_000),
    });
    const revokedToken = await createAccessToken(ownerId as string, {
        revokedAt: new Date(),
    });
    const beforeCount = await database('test_executions')
        .where({ test_id: testId })
        .count('* as count')
        .first();

    const responses = await Promise.all([
        request(`/api/v1/tests/${testId}/execute`, undefined, { method: 'POST' }),
        request(`/api/v1/tests/${testId}/execute`, undefined, {
            method: 'POST',
            headers: { Authorization: 'Bearer gw_at_invalid' },
        }),
        request(`/api/v1/tests/${testId}/execute`, undefined, {
            method: 'POST',
            headers: { Authorization: `Bearer ${expiredToken}` },
        }),
        request(`/api/v1/tests/${testId}/execute`, undefined, {
            method: 'POST',
            headers: { Authorization: `Bearer ${revokedToken}` },
        }),
    ]);
    assert.deepEqual(responses.map(({ status }) => status), [401, 401, 401, 401]);

    const afterCount = await database('test_executions')
        .where({ test_id: testId })
        .count('* as count')
        .first();
    assert.equal(afterCount?.count, beforeCount?.count);
});

test('does not allow an access token to execute another user’s test', async () => {
    const token = await createAccessToken(otherUserId as string);
    const beforeCount = await database('test_executions')
        .where({ test_id: testId })
        .count('* as count')
        .first();
    const response = await request(`/api/v1/tests/${testId}/execute`, undefined, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
    });
    const afterCount = await database('test_executions')
        .where({ test_id: testId })
        .count('* as count')
        .first();
    assert.equal(response.status, 404);
    assert.equal(afterCount?.count, beforeCount?.count);
});

test('persists failed upstream executions initiated by an access token as CI/CD', async () => {
    await updateDefinition('/disconnect', []);
    const token = await createAccessToken(ownerId as string);
    const response = await request(`/api/v1/tests/${testId}/execute`, undefined, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    const data = (response.body as {
        data: { executionId: string; status: string; passed: boolean };
    }).data;
    assert.equal(data.status, 'ERROR');
    assert.equal(data.passed, false);
    const persisted = await database('test_executions')
        .where({ id: data.executionId })
        .first('trigger_type', 'status', 'result');
    assert.equal(persisted?.trigger_type, 'CI_CD');
    assert.equal(persisted?.status, 'ERROR');
    assert.equal(JSON.stringify(persisted?.result).includes(token), false);
});

test('rejects malformed bearer credentials and does not enable tokens on other management routes', async () => {
    const token = await createAccessToken(ownerId as string);
    const beforeCount = await database('test_executions')
        .where({ test_id: testId })
        .count('* as count')
        .first();
    const responses = await Promise.all([
        request(`/api/v1/tests/${testId}/execute`, undefined, {
            method: 'POST',
            headers: { Authorization: 'Basic abc' },
        }),
        request(`/api/v1/tests/${testId}/execute`, undefined, {
            method: 'POST',
            headers: { Authorization: 'Bearer' },
        }),
        request(`/api/v1/tests/${testId}/execute`, undefined, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token} extra` },
        }),
        request(`/api/v1/tests/${testId}`, undefined, {
            headers: { Authorization: `Bearer ${token}` },
        }),
    ]);
    assert.deepEqual(responses.map(({ status }) => status), [401, 401, 401, 401]);
    const afterCount = await database('test_executions')
        .where({ test_id: testId })
        .count('* as count')
        .first();
    assert.equal(afterCount?.count, beforeCount?.count);
});

test('rejects access tokens belonging to disabled owners without executing tests', async () => {
    const token = await createAccessToken(ownerId as string);
    const beforeCount = await database('test_executions')
        .where({ test_id: testId })
        .count('* as count')
        .first();
    await database('users').where({ id: ownerId }).update({ status: 'ADMIN_DISABLED' });
    try {
        const response = await request(`/api/v1/tests/${testId}/execute`, undefined, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
        });
        assert.equal(response.status, 401);
        const afterCount = await database('test_executions')
            .where({ test_id: testId })
            .count('* as count')
            .first();
        assert.equal(afterCount?.count, beforeCount?.count);
    } finally {
        await database('users').where({ id: ownerId }).update({ status: 'ACTIVE' });
    }
});

test('rejects access tokens belonging to soft-deleted owners without executing tests', async () => {
    const token = await createAccessToken(ownerId as string);
    const beforeCount = await database('test_executions')
        .where({ test_id: testId })
        .count('* as count')
        .first();
    await database('users').where({ id: ownerId }).update({
        status: 'DELETED',
        deleted_at: database.fn.now(),
    });
    try {
        const response = await request(`/api/v1/tests/${testId}/execute`, undefined, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
        });
        assert.equal(response.status, 401);
        const afterCount = await database('test_executions')
            .where({ test_id: testId })
            .count('* as count')
            .first();
        assert.equal(afterCount?.count, beforeCount?.count);
    } finally {
        await database('users').where({ id: ownerId }).update({
            status: 'ACTIVE',
            deleted_at: null,
        });
    }
});

test('returns the completed execution if its audit write fails and does not execute twice', async () => {
    await updateDefinition('/', [
        { type: 'STATUS_CODE', operator: 'EQUALS', expected: 200 },
    ]);
    const cleanupAuditTrigger = await installAuditFailureTrigger();
    const beforeCount = await database('test_executions')
        .where({ test_id: testId })
        .count('* as count')
        .first();
    try {
        const response = await request(`/api/v1/tests/${testId}/execute`, ownerCookie, {
            method: 'POST',
        });
        assert.equal(response.status, 200);
        const data = (response.body as {
            data: { executionId: string; status: string; passed: boolean };
        }).data;
        assert.equal(data.status, 'PASSED');
        assert.equal(data.passed, true);
        assert.ok(data.executionId);
        const afterCount = await database('test_executions')
            .where({ test_id: testId })
            .count('* as count')
            .first();
        assert.equal(Number(afterCount?.count) - Number(beforeCount?.count), 1);
    } finally {
        await cleanupAuditTrigger();
    }
});

test('rolls back access-token creation when its audit write fails', async () => {
    const cleanupAuditTrigger = await installAuditFailureTrigger();
    const beforeCount = await database('access_tokens')
        .where({ user_id: ownerId })
        .count('* as count')
        .first();
    try {
        const response = await request('/api/v1/users/me/access-tokens', ownerCookie, {
            method: 'POST',
            body: JSON.stringify({ name: 'Undisclosed test token' }),
        });
        assert.equal(response.status, 503);
        assert.equal(JSON.stringify(response.body).includes('gw_at_'), false);
        const afterCount = await database('access_tokens')
            .where({ user_id: ownerId })
            .count('* as count')
            .first();
        assert.equal(afterCount?.count, beforeCount?.count);
    } finally {
        await cleanupAuditTrigger();
    }
});