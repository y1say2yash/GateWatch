import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';

import app from '../src/app.js';
import database from '../src/config/database.js';
import { describeAuthentication } from '../src/tests/test-credentials.js';
import { nextTestGithubId } from './test-user-identity.js';

interface TestResponse {
    data: {
        id: string;
        authentication: { type: string; credentialConfigured: boolean };
        name: string;
    };
}

let server: ReturnType<typeof app.listen>;
let origin: string;
let ownerId: string;
let otherUserId: string;
let adminId: string;
let ownedApiId: string;
let otherApiId: string;
let ownerCookie: string;
let otherCookie: string;
let adminCookie: string;
async function createUser(isAdmin = false): Promise<{ id: string; cookie: string }> {
    const suffix = crypto.randomUUID();
    const [user] = await database<{ id: string }>('users')
        .insert({
            github_id: nextTestGithubId(),
            github_username: `test-def-${suffix}`,
            is_admin: isAdmin,
        })
        .returning('id');
    const token = crypto.randomBytes(32).toString('hex');
    await database('sessions').insert({
        user_id: user.id,
        token_hash: crypto.createHash('sha256').update(token).digest('hex'),
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
    });
    return { id: user.id, cookie: `gatewatch_session=${token}` };
}

async function createApi(userId: string): Promise<string> {
    const [project] = await database<{ id: string }>('projects')
        .insert({
            user_id: userId,
            name: `Test project ${crypto.randomUUID()}`,
            slug: `test-${crypto.randomUUID()}`,
        })
        .returning('id');
    const [api] = await database<{ id: string }>('apis')
        .insert({
            project_id: project.id,
            name: `Test API ${crypto.randomUUID()}`,
            upstream_url: 'https://api.test.invalid',
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

before(async () => {
    process.env.TEST_CREDENTIAL_ENCRYPTION_KEY = 'b'.repeat(64);
    const owner = await createUser();
    ownerId = owner.id;
    ownerCookie = owner.cookie;
    const other = await createUser();
    otherUserId = other.id;
    otherCookie = other.cookie;
    const admin = await createUser(true);
    adminId = admin.id;
    adminCookie = admin.cookie;
    ownedApiId = await createApi(ownerId);
    otherApiId = await createApi(otherUserId);
    server = app.listen(0);
    await once(server, 'listening');
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
    if (server) {
        const closed = once(server, 'close');
        server.close();
        await closed;
    }
    const userIds = [ownerId, otherUserId, adminId].filter(Boolean);
    if (userIds.length) {
        await database('audit_logs').whereIn('user_id', userIds).delete();
        await database('users').whereIn('id', userIds).delete();
    }
    await database.destroy();
});

test('supports owned test-definition CRUD while protecting credentials and ownership', async () => {
    const unauthenticated = await request(`/api/v1/apis/${ownedApiId}/tests`);
    assert.equal(unauthenticated.status, 401);

    const invalidCreate = await request(
        `/api/v1/apis/${ownedApiId}/tests`,
        ownerCookie,
        {
            method: 'POST',
            body: JSON.stringify({
                name: 'Invalid target',
                method: 'GET',
                url: 'https://not-the-api.test.invalid/private',
                assertions: [],
            }),
        },
    );
    assert.equal(invalidCreate.status, 400);

    const create = await request(
        `/api/v1/apis/${ownedApiId}/tests`,
        ownerCookie,
        {
            method: 'POST',
            body: JSON.stringify({
                name: 'Owned test',
                method: 'GET',
                url: 'https://api.test.invalid/health',
                headers: { accept: 'application/json' },
                body: null,
                authentication: { type: 'BEARER', token: 'test-private-secret' },
                assertions: [
                    { type: 'STATUS_CODE', operator: 'EQUALS', expected: 200 },
                    {
                        type: 'JSON_BODY',
                        path: '/healthy',
                        operator: 'EQUALS',
                        expected: true,
                    },
                ],
            }),
        },
    );
    assert.equal(create.status, 201);
    const created = (create.body as { data: TestResponse['data'] }).data;
    assert.deepEqual(created.authentication, {
        type: 'BEARER',
        credentialConfigured: true,
    });
    assert.equal(JSON.stringify(create.body).includes('test-private-secret'), false);

    const stored = await database('tests').where({ id: created.id }).first();
    assert.equal(JSON.stringify(stored.authentication).includes('test-private-secret'), false);
    assert.equal(JSON.stringify(stored.assertions).includes('test-private-secret'), false);
    assert.deepEqual(describeAuthentication(stored.authentication), {
        type: 'BEARER',
        credentialConfigured: true,
    });
    assert.deepEqual(stored.headers, { accept: 'application/json' });
    assert.deepEqual(stored.assertions, [
        { type: 'STATUS_CODE', operator: 'EQUALS', expected: 200 },
        {
            type: 'JSON_BODY',
            path: '/healthy',
            operator: 'EQUALS',
            expected: true,
        },
    ]);

    const list = await request(`/api/v1/apis/${ownedApiId}/tests`, ownerCookie);
    assert.equal(list.status, 200);
    assert.equal((list.body as { data: unknown[] }).data.length, 1);

    const get = await request(`/api/v1/tests/${created.id}`, ownerCookie);
    assert.equal(get.status, 200);
    assert.equal(JSON.stringify(get.body).includes('test-private-secret'), false);
    const returnedAssertions =
        (get.body as { data: { assertions: unknown } }).data.assertions;
    assert.ok(Array.isArray(returnedAssertions));
    assert.deepEqual(
        returnedAssertions,
        [
            { type: 'STATUS_CODE', operator: 'EQUALS', expected: 200 },
            {
                type: 'JSON_BODY',
                path: '/healthy',
                operator: 'EQUALS',
                expected: true,
            },
        ],
    );

    const update = await request(`/api/v1/tests/${created.id}`, ownerCookie, {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Renamed test' }),
    });
    assert.equal(update.status, 200);
    assert.equal(
        (update.body as { data: TestResponse['data'] }).data.name,
        'Renamed test',
    );

    for (const [cookie, apiId] of [
        [otherCookie, ownedApiId],
        [adminCookie, ownedApiId],
    ] as const) {
        const hiddenApi = await request(`/api/v1/apis/${apiId}/tests`, cookie);
        assert.equal(hiddenApi.status, 404);
    }
    for (const cookie of [otherCookie, adminCookie]) {
        assert.equal(
            (await request(`/api/v1/tests/${created.id}`, cookie)).status,
            404,
        );
        assert.equal(
            (await request(`/api/v1/tests/${created.id}`, cookie, {
                method: 'PATCH',
                body: JSON.stringify({ name: 'Unauthorized edit' }),
            })).status,
            404,
        );
        assert.equal(
            (await request(`/api/v1/tests/${created.id}`, cookie, {
                method: 'DELETE',
            })).status,
            404,
        );
    }
    const foreignCreate = await request(
        `/api/v1/apis/${otherApiId}/tests`,
        ownerCookie,
        {
            method: 'POST',
            body: JSON.stringify({
                name: 'Foreign test',
                method: 'GET',
                url: 'https://api.test.invalid/health',
                assertions: [],
            }),
        },
    );
    assert.equal(foreignCreate.status, 404);

    const remove = await request(`/api/v1/tests/${created.id}`, ownerCookie, {
        method: 'DELETE',
    });
    assert.equal(remove.status, 204);
    assert.ok((await database('tests').where({ id: created.id }).first()).deleted_at);
    assert.equal(
        (await request(`/api/v1/tests/${created.id}`, ownerCookie)).status,
        404,
    );

    const audit = await database('audit_logs')
        .where({ resource_type: 'TEST', resource_id: created.id })
        .select('action', 'details')
        .orderBy('created_at');
    assert.deepEqual(audit.map((row) => row.action).sort(), [
        'TEST_CREATED',
        'TEST_DELETED',
        'TEST_UPDATED',
    ]);
    assert.equal(JSON.stringify(audit).includes('test-private-secret'), false);
});
