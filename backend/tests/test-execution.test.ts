import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { after, before, test } from 'node:test';

import app from '../src/app.js';
import database from '../src/config/database.js';

let upstreamServer: Server | undefined;
let appServer: Server | undefined;
let upstreamOrigin: string;
let origin: string;
let ownerId: string | undefined;
const fixtureUserIds: string[] = [];
let nextFixtureGithubId = BigInt(Date.now()) * 1000n;
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
            github_id: Number(nextFixtureGithubId++),
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

test('redacts sensitive fields from persisted assertion summaries', async () => {
    await updateDefinition('/sensitive', [
        {
            type: 'JSON_BODY',
            path: '/profile',
            operator: 'EXISTS',
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
        .first('result');

    const serialized = JSON.stringify({
        response: data.data.result,
        persisted: persisted?.result,
    });

    assert.equal(serialized.includes('must-not-be-stored'), false);
    assert.equal(serialized.includes('nested-secret'), false);
    assert.equal(serialized.includes('[REDACTED]'), true);
});