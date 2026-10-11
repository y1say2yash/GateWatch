import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';
import { test } from 'node:test';

import { handleAuditLogListError } from '../src/admin/admin-controller.js';
import {
    AuditLogQueryValidationError,
    validateAuditLogFilters,
} from '../src/admin/admin-service.js';
import { requireAdmin } from '../src/auth/admin-middleware.js';

test('validates supported audit-log pagination and inclusive dates', () => {
    const filters = validateAuditLogFilters({
        from: '2026-10-01T00:00:00.000Z',
        to: '2026-10-02T00:00:00.000Z',
    });

    assert.deepEqual(filters, {
        page: 1,
        limit: 20,
        from: new Date('2026-10-01T00:00:00.000Z'),
        to: new Date('2026-10-02T00:00:00.000Z'),
    });
    assert.deepEqual(
        validateAuditLogFilters({ page: '2', limit: '100' }),
        { page: 2, limit: 100, from: undefined, to: undefined },
    );
});

test('rejects invalid, reversed, repeated, unsupported and out-of-range queries', () => {
    for (const query of [
        { page: '0' },
        { page: '1.5' },
        { limit: '101' },
        { from: 'not-a-date' },
        { from: '2026-02-01', to: '2026-01-01' },
        { from: ['2026-01-01'] },
        { action: 'LOGIN' },
        { sort: 'created_at' },
    ]) {
        assert.throws(
            () => validateAuditLogFilters(query),
            AuditLogQueryValidationError,
        );
    }
});

test('Admin authorization uses the authenticated user role and returns 403 for Users', () => {
    let nextCalled = false;
    const captured: { status?: number; body?: unknown } = {};
    const response = {
        locals: { user: { id: 'user-id', isAdmin: false } },
        status(status: number) {
            captured.status = status;
            return this;
        },
        json(body: unknown) {
            captured.body = body;
            return this;
        },
    } as Response;

    requireAdmin(
        {} as Request,
        response,
        (() => {
            nextCalled = true;
        }) as NextFunction,
    );

    assert.equal(nextCalled, false);
    assert.equal(captured.status, 403);
    assert.deepEqual(captured.body, {
        error: {
            code: 'ADMIN_ACCESS_REQUIRED',
            message: 'Administrator access is required.',
        },
    });
});

test('Admin authorization permits authenticated Admins', () => {
    let nextCalled = false;
    const response = {
        locals: { user: { id: 'admin-id', isAdmin: true } },
    } as Response;

    requireAdmin(
        {} as Request,
        response,
        (() => {
            nextCalled = true;
        }) as NextFunction,
    );

    assert.equal(nextCalled, true);
});

test('database listing errors return a safe structured response', () => {
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

    handleAuditLogListError(
        new Error('database password and SQL details'),
        response,
    );

    assert.equal(captured.status, 500);
    assert.deepEqual(captured.body, {
        error: {
            code: 'AUDIT_LOG_LIST_FAILED',
            message: 'Failed to retrieve audit logs.',
        },
    });
    assert.equal(JSON.stringify(captured.body).includes('database password'), false);
});
