import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { after, before, test } from 'node:test';

import database from '../src/config/database.js';
import {
    AuditLogWriteError,
    sendAuditLogFailure,
    writeAuditLog,
} from '../src/audit/audit-service.js';
import { createProject } from '../src/projects/project-controller.js';

let actorUserId: string;

before(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const [user] = await database<{ id: string }>('users')
        .insert({
            github_id: String(Date.now() * 10 + 13),
            github_username: `audit-test-${suffix}`,
        })
        .returning('id');
    actorUserId = user.id;
});

after(async () => {
    if (actorUserId) {
        await database('audit_logs')
            .where({ user_id: actorUserId })
            .delete();
        await database('users').where({ id: actorUserId }).delete();
    }
    await database.destroy();
});

test('writes one successful management audit event with trusted actor fields', async () => {
    const resourceId = randomUUID();
    await writeAuditLog({
        actorUserId,
        actorRole: 'USER',
        action: 'API_CREATED',
        resourceType: 'API',
        resourceId,
        metadata: {
            name: 'Example API',
            actorRole: 'ADMIN',
            apiKey: 'must-not-persist',
        },
    });

    const row = await database('audit_logs')
        .where({
            user_id: actorUserId,
            action: 'API_CREATED',
            resource_type: 'API',
            resource_id: resourceId,
        })
        .first();
    assert.ok(row);
    assert.equal(row.actor_role, 'USER');
    assert.deepEqual(row.details, { name: 'Example API' });
});

test('audits a successfully created project with its authenticated actor', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const request = {
        body: {
            name: `Audited project ${suffix}`,
            slug: `audit-project-${suffix}`,
        },
        socket: { remoteAddress: '127.0.0.1' },
    } as Request;
    const captured: {
        status?: number;
        body?: unknown;
    } = {};
    const response = {
        locals: { user: { id: actorUserId, isAdmin: false } },
        status(status: number) {
            captured.status = status;
            return this;
        },
        json(body: unknown) {
            captured.body = body;
            return this;
        },
    } as Response;

    await createProject(request, response);

    assert.equal(captured.status, 201);
    assert.equal(
        typeof captured.body === 'object' &&
        captured.body !== null &&
        'data' in captured.body,
        true,
    );
    const projectId = (
        captured.body as { data: { id: string } }
    ).data.id;
    const audit = await database('audit_logs')
        .where({
            user_id: actorUserId,
            action: 'PROJECT_CREATED',
            resource_type: 'PROJECT',
            resource_id: projectId,
        })
        .first();

    assert.ok(audit);
    assert.equal(audit.actor_role, 'USER');
});

test('converts database audit-write failures into a generic 503 policy response', async () => {
    await assert.rejects(
        writeAuditLog({
            actorUserId: randomUUID(),
            actorRole: 'USER',
            action: 'API_CREATED',
            resourceType: 'API',
        }),
        AuditLogWriteError,
    );

    const captured: { status?: number; body?: unknown } = {};
    const response = {
        status(status: number) {
            captured.status = status;
            return this;
        },
        json(body: unknown) {
            captured.body = body;
            return this;
        },
    } as Response;

    assert.equal(
        sendAuditLogFailure(new AuditLogWriteError(), response),
        true,
    );
    assert.equal(captured.status, 503);
    assert.deepEqual(captured.body, {
        error: {
            code: 'AUDIT_LOG_UNAVAILABLE',
            message: 'Audit logging is temporarily unavailable.',
        },
    });
});
