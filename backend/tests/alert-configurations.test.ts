import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, mock, test } from 'node:test';

import app from '../src/app.js';
import database from '../src/config/database.js';
import { createApi } from '../src/apis/api-repository.js';
import { validateAlertConfiguration } from '../src/alerts/alert-validation.js';
import { nextTestGithubId } from './test-user-identity.js';

let ownerId: string;
let otherUserId: string;
let apiId: string;
let foreignApiId: string;
let deletedApiId: string;
let ownerSession: string;
let otherSession: string;
let server: ReturnType<typeof createServer>;
let baseUrl: string;

async function createUser(usernamePrefix: string): Promise<string> {
    const suffix = randomUUID();
    const [user] = await database<{ id: string }>('users')
        .insert({
            github_id: nextTestGithubId(),
            github_username: `${usernamePrefix}-${suffix}`,
        })
        .returning('id');
    return user.id;
}

async function createSession(userId: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    await database('sessions').insert({
        user_id: userId,
        token_hash: createHash('sha256').update(token).digest('hex'),
        expires_at: new Date(Date.now() + 60_000),
    });
    return token;
}

async function createApiForUser(
    userId: string,
    name: string,
): Promise<string> {
    const suffix = randomUUID();
    const [project] = await database<{ id: string }>('projects')
        .insert({
            user_id: userId,
            name: `${name} project`,
            slug: `${name}-${suffix}`,
        })
        .returning('id');
    const api = await createApi(project.id, {
        name: `${name} API`,
        upstreamUrl: 'https://example.test',
    });
    return api.id;
}

function cookie(token: string): string {
    return `gatewatch_session=${token}`;
}

async function request(
    path: string,
    options: {
        method?: string;
        body?: unknown;
        token?: string;
    } = {},
): Promise<{ status: number; body: unknown }> {
    const headers: Record<string, string> = {};
    if (options.token) {
        headers.cookie = cookie(options.token);
    }
    if (options.body !== undefined) {
        headers['content-type'] = 'application/json';
    }
    const response = await fetch(`${baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers,
        ...(options.body !== undefined && {
            body: JSON.stringify(options.body),
        }),
    });
    const body = response.status === 204
        ? undefined
        : await response.json();
    return { status: response.status, body };
}

function data<T>(body: unknown): T {
    assert.equal(typeof body, 'object');
    assert.notEqual(body, null);
    assert.ok('data' in body);
    return body.data as T;
}

before(async () => {
    ownerId = await createUser('alert-owner');
    otherUserId = await createUser('alert-other');
    ownerSession = await createSession(ownerId);
    otherSession = await createSession(otherUserId);
    apiId = await createApiForUser(ownerId, 'alerts-owned');
    foreignApiId = await createApiForUser(otherUserId, 'alerts-foreign');
    deletedApiId = await createApiForUser(ownerId, 'alerts-deleted');
    await database('apis')
        .where({ id: deletedApiId })
        .update({ status: 'DELETED', deleted_at: database.fn.now() });

    server = createServer(app);
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});

after(async () => {
    if (ownerId || otherUserId) {
        await database('audit_logs')
            .whereIn('user_id', [ownerId, otherUserId].filter(Boolean))
            .delete();
        await database('users')
            .whereIn('id', [ownerId, otherUserId].filter(Boolean))
            .delete();
    }
    if (server) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await database.destroy();
});

test('creates, retrieves, and lists an owned alert configuration', async () => {
    const created = await request(`/apis/${apiId}/alerts`, {
        method: 'POST',
        token: ownerSession,
        body: {
            name: 'Elevated errors',
            type: 'ERROR_RATE',
            configuration: { threshold: 0.05, windowSeconds: 300 },
        },
    });
    assert.equal(created.status, 201);
    const alert = data<{
        id: string;
        apiId: string;
        name: string;
        type: string;
        configuration: unknown;
    }>(created.body);
    assert.equal(alert.apiId, apiId);
    assert.equal(alert.type, 'ERROR_RATE');
    assert.deepEqual(alert.configuration, {
        threshold: 0.05,
        windowSeconds: 300,
    });

    const retrieved = await request(`/alerts/${alert.id}`, {
        token: ownerSession,
    });
    assert.equal(retrieved.status, 200);
    assert.deepEqual(data(retrieved.body), alert);

    const listed = await request(`/apis/${apiId}/alerts`, {
        token: ownerSession,
    });
    assert.equal(listed.status, 200);
    assert.ok((data<unknown[]>(listed.body)).some(
        (item) => (item as { id: string }).id === alert.id,
    ));
});

test('updates an alert and validates the complete new type configuration', async () => {
    const created = await request(`/apis/${apiId}/alerts`, {
        method: 'POST',
        token: ownerSession,
        body: {
            name: 'Slow API',
            type: 'LATENCY',
            configuration: { thresholdMs: 1_000, windowSeconds: 300 },
        },
    });
    const alert = data<{ id: string }>(created.body);
    const updated = await request(`/alerts/${alert.id}`, {
        method: 'PATCH',
        token: ownerSession,
        body: {
            name: 'Very slow API',
            type: 'UNHEALTHY_DURATION',
            configuration: { durationSeconds: 120 },
        },
    });
    const updatedAlert = data<Record<string, unknown>>(updated.body);

    assert.equal(updated.status, 200);
    assert.deepEqual(data(updated.body), {
        ...data<Record<string, unknown>>(created.body),
        name: 'Very slow API',
        type: 'UNHEALTHY_DURATION',
        configuration: { durationSeconds: 120 },
        updatedAt: updatedAlert.updatedAt,
    });

    const invalidTypeChange = await request(`/alerts/${alert.id}`, {
        method: 'PATCH',
        token: ownerSession,
        body: { type: 'ERROR_RATE' },
    });
    assert.equal(invalidTypeChange.status, 400);
});

test('enables and disables alert configurations', async () => {
    const created = await request(`/apis/${apiId}/alerts`, {
        method: 'POST',
        token: ownerSession,
        body: {
            name: 'API is down',
            type: 'API_DOWN',
            configuration: {},
        },
    });
    const alert = data<{ id: string }>(created.body);

    const disabled = await request(`/alerts/${alert.id}/disable`, {
        method: 'POST',
        token: ownerSession,
    });
    assert.equal(disabled.status, 200);
    assert.equal(data<{ enabled: boolean }>(disabled.body).enabled, false);

    const enabled = await request(`/alerts/${alert.id}/enable`, {
        method: 'POST',
        token: ownerSession,
    });
    assert.equal(enabled.status, 200);
    assert.equal(data<{ enabled: boolean }>(enabled.body).enabled, true);
});

test('soft-deletes an alert and excludes it from normal reads', async () => {
    const created = await request(`/apis/${apiId}/alerts`, {
        method: 'POST',
        token: ownerSession,
        body: {
            name: 'Long unhealthy period',
            type: 'UNHEALTHY_DURATION',
            configuration: { durationSeconds: 900 },
        },
    });
    const alert = data<{ id: string }>(created.body);

    const deleted = await request(`/alerts/${alert.id}`, {
        method: 'DELETE',
        token: ownerSession,
    });
    assert.equal(deleted.status, 204);
    assert.equal(
        (await request(`/alerts/${alert.id}`, { token: ownerSession })).status,
        404,
    );
    const listed = await request(`/apis/${apiId}/alerts`, {
        token: ownerSession,
    });
    assert.equal(
        (data<unknown[]>(listed.body)).some(
            (item) => (item as { id: string }).id === alert.id,
        ),
        false,
    );
});

test('rejects unauthenticated requests and hides foreign or deleted resources', async () => {
    const created = await request(`/apis/${apiId}/alerts`, {
        method: 'POST',
        token: ownerSession,
        body: {
            name: 'Owner-only alert',
            type: 'API_DOWN',
            configuration: {},
        },
    });
    const alert = data<{ id: string }>(created.body);

    const unauthorizedSince = new Date();
    assert.equal((await request(`/alerts/${alert.id}`)).status, 401);
    const authFailure = await database('audit_logs')
        .where({
            action: 'AUTHENTICATION_FAILED',
            resource_type: 'SESSION',
        })
        .whereRaw("details->>'reason' = 'SESSION_REQUIRED'")
        .where('created_at', '>=', unauthorizedSince)
        .orderBy('created_at', 'desc')
        .first('id');
    if (authFailure) {
        await database('audit_logs').where({ id: authFailure.id }).delete();
    }
    assert.equal(
        (await request(`/apis/${foreignApiId}/alerts`, {
            token: ownerSession,
        })).status,
        404,
    );
    assert.equal(
        (await request(`/apis/${deletedApiId}/alerts`, {
            token: ownerSession,
        })).status,
        404,
    );
    assert.equal(
        (await request(`/alerts/${alert.id}`, {
            token: otherSession,
        })).status,
        404,
    );
    assert.equal(
        (await request(`/apis/${foreignApiId}/alerts`, {
            method: 'POST',
            token: ownerSession,
            body: {
                name: 'Unauthorized alert',
                type: 'API_DOWN',
                configuration: {},
            },
        })).status,
        404,
    );
});

test('validates each supported type and rejects invalid or missing fields', async () => {
    assert.deepEqual(validateAlertConfiguration('API_DOWN', {}), {});
    assert.deepEqual(
        validateAlertConfiguration('UNHEALTHY_DURATION', {
            durationSeconds: 60,
        }),
        { durationSeconds: 60 },
    );
    assert.deepEqual(
        validateAlertConfiguration('ERROR_RATE', {
            threshold: 0.05,
            windowSeconds: 300,
        }),
        { threshold: 0.05, windowSeconds: 300 },
    );
    assert.deepEqual(
        validateAlertConfiguration('LATENCY', {
            thresholdMs: 250,
            windowSeconds: 300,
        }),
        { thresholdMs: 250, windowSeconds: 300 },
    );

    const invalidBodies: Array<{
        description: string;
        body: Record<string, unknown>;
    }> = [
            {
                description: 'Unknown type',
                body: { name: 'Unknown type', type: 'CPU', configuration: {} },
            },
            {
                description: 'Missing type',
                body: { name: 'Missing type', configuration: {} },
            },
            {
                description: 'Missing name',
                body: { type: 'API_DOWN', configuration: {} },
            },
            {
                description: 'Empty name',
                body: { name: '', type: 'API_DOWN', configuration: {} },
            },
            {
                description: 'Whitespace-only name',
                body: { name: '  \t', type: 'API_DOWN', configuration: {} },
            },
            {
                description: 'Non-string name',
                body: { name: 12, type: 'API_DOWN', configuration: {} },
            },
            {
                description: 'Overlong name',
                body: {
                    name: 'a'.repeat(101),
                    type: 'API_DOWN',
                    configuration: {},
                },
            },
            {
                description: 'Invalid down config',
                body: {
                    name: 'Invalid down config',
                    type: 'API_DOWN',
                    configuration: { x: 1 },
                },
            },
            {
                description: 'Missing duration',
                body: {
                    name: 'Missing duration',
                    type: 'UNHEALTHY_DURATION',
                    configuration: {},
                },
            },
            {
                description: 'Negative duration',
                body: {
                    name: 'Negative duration',
                    type: 'UNHEALTHY_DURATION',
                    configuration: { durationSeconds: -1 },
                },
            },
            {
                description: 'Missing rate window',
                body: {
                    name: 'Missing rate window',
                    type: 'ERROR_RATE',
                    configuration: { threshold: 0.1 },
                },
            },
            {
                description: 'Negative rate',
                body: {
                    name: 'Negative rate',
                    type: 'ERROR_RATE',
                    configuration: { threshold: -0.1, windowSeconds: 60 },
                },
            },
            {
                description: 'Invalid rate window',
                body: {
                    name: 'Invalid rate window',
                    type: 'ERROR_RATE',
                    configuration: { threshold: 0.1, windowSeconds: 30 },
                },
            },
            {
                description: 'Missing latency threshold',
                body: {
                    name: 'Missing latency threshold',
                    type: 'LATENCY',
                    configuration: { windowSeconds: 60 },
                },
            },
            {
                description: 'Invalid latency threshold',
                body: {
                    name: 'Invalid latency threshold',
                    type: 'LATENCY',
                    configuration: { thresholdMs: 0, windowSeconds: 60 },
                },
            },
            {
                description: 'Unsupported field',
                body: {
                    name: 'Unsupported field',
                    type: 'LATENCY',
                    configuration: {
                        thresholdMs: 100,
                        windowSeconds: 60,
                        unit: 'seconds',
                    },
                },
            },
        ];
    for (const { body, description } of invalidBodies) {
        const result = await request(`/apis/${apiId}/alerts`, {
            method: 'POST',
            token: ownerSession,
            body,
        });
        assert.equal(result.status, 400, description);
        assert.equal(typeof result.body, 'object');
        assert.notEqual(result.body, null);
        assert.ok('error' in result.body);
        const errorBody = result.body.error as {
            code: string;
            message: unknown;
        };
        assert.equal(errorBody.code, 'INVALID_ALERT_CONFIG', description);
        assert.equal(typeof errorBody.message, 'string', description);
    }

    const emptyPatch = await request(`/apis/${apiId}/alerts`, {
        method: 'POST',
        token: ownerSession,
        body: {
            name: 'Patch validation',
            type: 'API_DOWN',
            configuration: {},
        },
    });
    const patchAlert = data<{ id: string }>(emptyPatch.body);
    assert.equal(
        (await request(`/alerts/${patchAlert.id}`, {
            method: 'PATCH',
            token: ownerSession,
            body: {},
        })).status,
        400,
    );
});

test('writes safe audit metadata for create, update, enable, disable, and delete', async () => {
    const created = await request(`/apis/${apiId}/alerts`, {
        method: 'POST',
        token: ownerSession,
        body: {
            name: 'Audit-safe alert',
            type: 'ERROR_RATE',
            configuration: { threshold: 0.1, windowSeconds: 600 },
        },
    });
    const alert = data<{ id: string }>(created.body);

    await request(`/alerts/${alert.id}`, {
        method: 'PATCH',
        token: ownerSession,
        body: {
            configuration: { threshold: 0.2, windowSeconds: 600 },
        },
    });
    await request(`/alerts/${alert.id}/disable`, {
        method: 'POST',
        token: ownerSession,
    });
    await request(`/alerts/${alert.id}/enable`, {
        method: 'POST',
        token: ownerSession,
    });
    await request(`/alerts/${alert.id}`, {
        method: 'DELETE',
        token: ownerSession,
    });

    const logs = await database('audit_logs')
        .where({
            user_id: ownerId,
            resource_type: 'ALERT',
            resource_id: alert.id,
        })
        .orderBy('created_at', 'asc');
    assert.deepEqual(
        logs.map((row: { action: string }) => row.action),
        [
            'ALERT_CONFIGURATION_CREATED',
            'ALERT_CONFIGURATION_UPDATED',
            'ALERT_CONFIGURATION_DISABLED',
            'ALERT_CONFIGURATION_ENABLED',
            'ALERT_CONFIGURATION_DELETED',
        ],
    );
    assert.deepEqual(logs[0].details, {
        name: 'Audit-safe alert',
        type: 'ERROR_RATE',
    });
    assert.deepEqual(logs[1].details, { type: 'ERROR_RATE' });
});

test('returns the standard generic error when alert persistence fails', async () => {
    const suffix = randomUUID().replaceAll('-', '');
    const functionName = `fail_alert_insert_${suffix}`;
    const triggerName = `fail_alert_insert_trigger_${suffix}`;
    await database.raw(`
        CREATE FUNCTION ${functionName}() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.name = 'Persistence failure' THEN
                RAISE EXCEPTION 'injected alert persistence failure';
            END IF;
            RETURN NEW;
        END;
        $$
    `);
    const capturedErrors: unknown[][] = [];
    const consoleErrorMock = mock.method(
        console,
        'error',
        (...args: unknown[]) => {
            capturedErrors.push(args);
        },
    );
    try {
        await database.raw(`
            CREATE TRIGGER ${triggerName}
            BEFORE INSERT ON alerts
            FOR EACH ROW EXECUTE FUNCTION ${functionName}()
        `);
        const result = await request(`/apis/${apiId}/alerts`, {
            method: 'POST',
            token: ownerSession,
            body: {
                name: 'Persistence failure',
                type: 'API_DOWN',
                configuration: {},
            },
        });
        assert.equal(result.status, 500);
        assert.deepEqual(result.body, {
            error: {
                code: 'ALERT_OPERATION_FAILED',
                message: 'Failed to process alert configuration request.',
            },
        });
        assert.equal(capturedErrors.length, 1);
        assert.equal(
            capturedErrors[0][0],
            'Alert configuration operation failed:',
        );
        assert.ok(capturedErrors[0][1] instanceof Error);
        assert.match(
            capturedErrors[0][1].message,
            /injected alert persistence failure/,
        );
    } finally {
        try {
            await database.raw(
                `DROP TRIGGER IF EXISTS ${triggerName} ON alerts`,
            );
        } finally {
            try {
                await database.raw(`DROP FUNCTION IF EXISTS ${functionName}()`);
            } finally {
                consoleErrorMock.mock.restore();
            }
        }
    }
});
