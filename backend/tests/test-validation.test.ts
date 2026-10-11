import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    TestTargetUrlError,
    TestValidationError,
    validateTestInput,
} from '../src/tests/test-validation.js';
import {
    describeAuthentication,
    protectAuthentication,
} from '../src/tests/test-credentials.js';

const upstreamUrl = 'https://api.example.com/v1';
const validDefinition = {
    name: 'Health',
    method: 'GET',
    url: 'https://api.example.com/v1/health',
    headers: { accept: 'application/json' },
    body: null,
    authentication: { type: 'NONE' },
    assertions: [
        { type: 'STATUS_CODE', operator: 'EQUALS', expected: 200 },
        {
            type: 'JSON_BODY',
            path: '/status',
            operator: 'EQUALS',
            expected: 'ok',
        },
        {
            type: 'RESPONSE_HEADER',
            name: 'content-type',
            operator: 'CONTAINS',
            expected: 'application/json',
        },
        {
            type: 'RESPONSE_TIME',
            operator: 'LESS_THAN_OR_EQUAL',
            expected: 1000,
        },
    ],
    timeoutMs: 5000,
};

test('validates and normalizes a complete test definition', () => {
    assert.deepEqual(validateTestInput(validDefinition, upstreamUrl), {
        ...validDefinition,
        url: 'https://api.example.com/v1/health',
    });
});

test('applies the documented default timeout', () => {
    const input = { ...validDefinition };
    delete (input as Partial<typeof input>).timeoutMs;
    assert.equal(
        validateTestInput(input, upstreamUrl).timeoutMs,
        5000,
    );
});

test('rejects unsupported methods, malformed URLs, and targets outside the API origin', () => {
    for (const definition of [
        { ...validDefinition, method: 'TRACE' },
        { ...validDefinition, url: 'javascript:alert(1)' },
        { ...validDefinition, url: 'https://user:pass@api.example.com/path' },
        { ...validDefinition, url: 'https://other.example.com/path' },
    ]) {
        assert.throws(
            () => validateTestInput(definition, upstreamUrl),
            (error: unknown) =>
                error instanceof TestValidationError ||
                error instanceof TestTargetUrlError,
        );
    }
});

test('rejects credential-bearing headers and malformed request data', () => {
    for (const definition of [
        { ...validDefinition, headers: ['not', 'an object'] },
        { ...validDefinition, headers: { Authorization: 'secret' } },
        { ...validDefinition, headers: { accept: 'line one\r\nline two' } },
        { ...validDefinition, body: BigInt(4) },
        { ...validDefinition, body: { password: 'body-secret' } },
        { ...validDefinition, authentication: { type: 'BEARER', token: '' } },
    ]) {
        assert.throws(
            () => validateTestInput(definition, upstreamUrl),
            TestValidationError,
        );
    }
});

test('rejects malformed assertion definitions and timeout boundaries', () => {
    for (const definition of [
        { ...validDefinition, assertions: [{ type: 'STATUS_CODE', expected: '200' }] },
        { ...validDefinition, assertions: [{ type: 'JSON_BODY', path: 'status', operator: 'EQUALS', expected: true }] },
        { ...validDefinition, assertions: [{ type: 'JSON_BODY', path: '/password', operator: 'EQUALS', expected: 'secret' }] },
        { ...validDefinition, assertions: [{ type: 'JSON_BODY', path: '/status~2value', operator: 'EQUALS', expected: true }] },
        { ...validDefinition, assertions: [{ type: 'RESPONSE_HEADER', name: 'authorization', operator: 'EXISTS' }] },
        { ...validDefinition, assertions: [{ type: 'RESPONSE_TIME', operator: 'LESS_THAN_OR_EQUAL', expected: -1 }] },
        { ...validDefinition, timeoutMs: 0 },
        { ...validDefinition, timeoutMs: 30_001 },
        { ...validDefinition, extra: true },
    ]) {
        assert.throws(
            () => validateTestInput(definition, upstreamUrl),
            TestValidationError,
        );
    }
});

test('does not accept private or local test targets without a development allowlist', () => {
    const priorMode = process.env.NODE_ENV;
    const priorOrigins = process.env.TEST_LOCAL_ALLOWED_ORIGINS;
    process.env.NODE_ENV = 'test';
    delete process.env.TEST_LOCAL_ALLOWED_ORIGINS;
    try {
        assert.throws(
            () => validateTestInput({
                ...validDefinition,
                url: 'http://127.0.0.1:3000/health',
            }, 'http://127.0.0.1:3000'),
            TestTargetUrlError,
        );
    } finally {
        if (priorMode === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = priorMode;
        if (priorOrigins === undefined) delete process.env.TEST_LOCAL_ALLOWED_ORIGINS;
        else process.env.TEST_LOCAL_ALLOWED_ORIGINS = priorOrigins;
    }
});

test('encrypts configured credentials and exposes only safe authentication metadata', () => {
    const prior = process.env.TEST_CREDENTIAL_ENCRYPTION_KEY;
    process.env.TEST_CREDENTIAL_ENCRYPTION_KEY = 'a'.repeat(64);
    try {
        for (const [authentication, secret] of [
            [{ type: 'BEARER', token: 'private-token' }, 'private-token'],
            [{ type: 'BASIC', username: 'operator', password: 'private-password' }, 'private-password'],
            [{ type: 'API_KEY', name: 'X-Client-Key', value: 'private-api-key' }, 'private-api-key'],
        ] as const) {
            const stored = protectAuthentication(authentication);
            assert.equal(JSON.stringify(stored).includes(secret), false);
            const visible = describeAuthentication(stored);
            assert.equal(JSON.stringify(visible).includes(secret), false);
            assert.equal(visible.credentialConfigured, true);
            assert.deepEqual(
                describeAuthentication(JSON.stringify(stored)),
                visible,
            );
        }
    } finally {
        if (prior === undefined) delete process.env.TEST_CREDENTIAL_ENCRYPTION_KEY;
        else process.env.TEST_CREDENTIAL_ENCRYPTION_KEY = prior;
    }
});
