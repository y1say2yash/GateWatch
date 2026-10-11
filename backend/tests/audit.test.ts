import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Response } from 'express';

import {
    AuditLogWriteError,
    sanitizeAuditMetadata,
    sendAuditLogFailure,
} from '../src/audit/audit-service.js';

test('audit metadata excludes sensitive and actor/resource override fields', () => {
    assert.deepEqual(
        sanitizeAuditMetadata({
            changedField: 'name',
            enabled: true,
            apiId: 'api-id',
            apiKey: 'secret-key',
            accessToken: 'secret-token',
            authorization: 'Bearer secret',
            requestBody: 'sensitive body',
            actorUserId: 'spoofed-user',
            actorRole: 'ADMIN',
            resourceId: 'spoofed-resource',
        }),
        {
            changedField: 'name',
            enabled: true,
            apiId: 'api-id',
        },
    );
});

test('audit write failures use a generic explicit 503 response', () => {
    const statusJson: {
        status?: number;
        body?: unknown;
    } = {};
    const response = {
        status(code: number) {
            statusJson.status = code;
            return this;
        },
        json(body: unknown) {
            statusJson.body = body;
            return this;
        },
    } as Response;

    assert.equal(
        sendAuditLogFailure(new AuditLogWriteError(), response),
        true,
    );
    assert.equal(statusJson.status, 503);
    assert.deepEqual(statusJson.body, {
        error: {
            code: 'AUDIT_LOG_UNAVAILABLE',
            message: 'Audit logging is temporarily unavailable.',
        },
    });
});
