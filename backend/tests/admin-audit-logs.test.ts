import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, request as httpRequest, type Server } from 'node:http';
import cookieParser from 'cookie-parser';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { after, before, mock, test } from 'node:test';

import adminRoutes from '../src/admin/admin-routes.js';
import database from '../src/config/database.js';

const FIXTURE_FROM = new Date('2090-01-01T00:00:00.000Z');
const FIXTURE_TO = new Date('2090-01-01T00:01:45.000Z');
const FIXTURE_ACTION_PREFIX = `ADMIN_AUDIT_TEST_${randomBytes(8).toString('hex')}`;
const FIXTURE_ACTIONS = Array.from(
    { length: 105 },
    (_, index) => `${FIXTURE_ACTION_PREFIX}_${index}`,
);

let adminUserId: string;
let normalUserId: string;
let adminToken: string;
let normalToken: string;
let server: Server;
let serverPort: number;

function listen(instance: Server): Promise<number> {
    return new Promise((resolve, reject) => {
        instance.once('error', reject);
        instance.listen(0, '127.0.0.1', () => {
            resolve((instance.address() as AddressInfo).port);
        });
    });
}

function request(
    path: string,
    token?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
    return new Promise((resolve, reject) => {
        const outgoing = httpRequest(
            {
                host: '127.0.0.1',
                port: serverPort,
                path,
                method: 'GET',
                headers: token
                    ? { cookie: `gatewatch_session=${token}` }
                    : {},
            },
            (response) => {
                let body = '';
                response.setEncoding('utf8');
                response.on('data', (chunk: string) => {
                    body += chunk;
                });
                response.on('end', () => {
                    resolve({
                        status: response.statusCode ?? 0,
                        body: body ? JSON.parse(body) as Record<string, unknown> : {},
                    });
                });
            },
        );
        outgoing.on('error', reject);
        outgoing.end();
    });
}

function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

before(async () => {
    const suffix = randomBytes(8).toString('hex');
    const [admin] = await database<{ id: string }>('users')
        .insert({
            github_id: String(Date.now() * 10 + 31),
            github_username: `audit-admin-${suffix}`,
            is_admin: true,
        })
        .returning('id');
    adminUserId = admin.id;

    const [normal] = await database<{ id: string }>('users')
        .insert({
            github_id: String(Date.now() * 10 + 32),
            github_username: `audit-user-${suffix}`,
            is_admin: false,
        })
        .returning('id');
    normalUserId = normal.id;

    adminToken = randomBytes(32).toString('hex');
    normalToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await database('sessions').insert([
        {
            user_id: adminUserId,
            token_hash: hashToken(adminToken),
            expires_at: expiresAt,
        },
        {
            user_id: normalUserId,
            token_hash: hashToken(normalToken),
            expires_at: expiresAt,
        },
    ]);

    await database('audit_logs').insert(
        Array.from({ length: 105 }, (_, index) => ({
            user_id: adminUserId,
            actor_role: 'ADMIN',
            action: FIXTURE_ACTIONS[index],
            resource_type: 'TEST_RESOURCE',
            resource_id: null,
            details: {
                safeField: `fixture-${index}`,
                apiKey: 'must-not-appear',
                nested: { requestBody: 'must-not-appear' },
            },
            ip_address: '127.0.0.1',
            created_at: new Date(FIXTURE_FROM.getTime() + index * 1000),
        })),
    );

    const app = express();
    app.use(cookieParser());
    app.use('/api/v1/admin', adminRoutes);
    server = createServer(app);
    serverPort = await listen(server);
});

after(async () => {
    if (server) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (adminUserId || normalUserId) {
        await database('audit_logs')
            .whereIn('action', FIXTURE_ACTIONS)
            .delete();
        await database('sessions')
            .whereIn('user_id', [adminUserId, normalUserId].filter(Boolean))
            .delete();
        await database('users')
            .whereIn('id', [adminUserId, normalUserId].filter(Boolean))
            .delete();
    }
    await database.destroy();
});

test('Admin can list audit logs with default pagination and safe fields', async () => {
    const response = await request(
        `/api/v1/admin/audit-logs?from=${FIXTURE_FROM.toISOString()}&to=${FIXTURE_TO.toISOString()}`,
        adminToken,
    );

    assert.equal(response.status, 200);
    const data = response.body.data as Array<Record<string, unknown>>;
    const pagination = response.body.pagination as Record<string, number>;
    assert.equal(data.length, 20);
    assert.deepEqual(pagination, {
        page: 1,
        limit: 20,
        total: 105,
        totalPages: 6,
    });
    assert.equal(data[0].action, `${FIXTURE_ACTION_PREFIX}_104`);
    assert.deepEqual(data[0].details, { safeField: 'fixture-104' });
    assert.equal(JSON.stringify(data).includes('must-not-appear'), false);
    assert.equal(data[0].ipAddress, '127.0.0.1');
});

test('audit-log pagination supports the maximum limit and page boundaries', async () => {
    const base =
        `/api/v1/admin/audit-logs?from=${FIXTURE_FROM.toISOString()}&to=${FIXTURE_TO.toISOString()}`;
    const firstPage = await request(`${base}&limit=100`, adminToken);
    const secondPage = await request(`${base}&limit=100&page=2`, adminToken);

    assert.equal(firstPage.status, 200);
    assert.equal(secondPage.status, 200);
    const firstData = firstPage.body.data as Array<Record<string, unknown>>;
    const secondData = secondPage.body.data as Array<Record<string, unknown>>;
    assert.equal(firstData.length, 100);
    assert.equal(secondData.length, 5);
    assert.equal(
        (secondPage.body.pagination as Record<string, number>).total,
        105,
    );
    assert.equal(
        (await request(`${base}&limit=101`, adminToken)).status,
        400,
    );
});

test('audit-log date filters are inclusive and reject invalid or reversed ranges', async () => {
    const from = FIXTURE_FROM.toISOString();
    const to = new Date(FIXTURE_FROM.getTime() + 5000).toISOString();
    const response = await request(
        `/api/v1/admin/audit-logs?from=${from}&to=${to}`,
        adminToken,
    );

    assert.equal(response.status, 200);
    assert.equal(
        (response.body.pagination as Record<string, number>).total,
        6,
    );
    assert.equal(
        (await request('/api/v1/admin/audit-logs?from=invalid', adminToken))
            .status,
        400,
    );
    assert.equal(
        (
            await request(
                '/api/v1/admin/audit-logs?from=2090-02-01&to=2090-01-01',
                adminToken,
            )
        ).status,
        400,
    );
});

test('audit-log query failures return a safe structured error', async () => {
    const originalQuery = database.client.query.bind(database.client);
    const queryStub = mock.method(
        database.client,
        'query',
        async (connection, queryConfig) => {
            if (queryConfig.sql.includes('"audit_logs"')) {
                throw new Error('simulated database query failure');
            }
            return originalQuery(connection, queryConfig);
        },
    );

    try {
        const response = await request(
            '/api/v1/admin/audit-logs',
            adminToken,
        );

        assert.equal(response.status, 500);
        assert.deepEqual(response.body, {
            error: {
                code: 'AUDIT_LOG_LIST_FAILED',
                message: 'Failed to retrieve audit logs.',
            },
        });
        assert.equal(
            JSON.stringify(response.body).includes(
                'simulated database query failure',
            ),
            false,
        );
    } finally {
        queryStub.mock.restore();
    }
});

test('authenticated normal Users are forbidden and unauthenticated requests are unauthorized', async () => {
    const normalResponse = await request(
        '/api/v1/admin/audit-logs',
        normalToken,
    );
    const unauthenticatedResponse = await request(
        '/api/v1/admin/audit-logs',
    );

    assert.equal(normalResponse.status, 403);
    assert.deepEqual(normalResponse.body, {
        error: {
            code: 'ADMIN_ACCESS_REQUIRED',
            message: 'Administrator access is required.',
        },
    });
    assert.equal(unauthenticatedResponse.status, 401);
});
