import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateCreateApiInput } from '../src/apis/api-validation.js';

const validApi = {
    name: 'Catalog',
    upstreamUrl: 'https://catalog.example.com/v1',
};

test('accepts a public HTTP upstream origin', () => {
    assert.equal(
        validateCreateApiInput(validApi).upstreamUrl,
        validApi.upstreamUrl,
    );
});

test('rejects upstream URL credentials, fragments, and private destinations', () => {
    const priorMode = process.env.NODE_ENV;
    const priorOrigins = process.env.TEST_LOCAL_ALLOWED_ORIGINS;
    process.env.NODE_ENV = 'production';
    delete process.env.TEST_LOCAL_ALLOWED_ORIGINS;
    try {
        for (const upstreamUrl of [
            'https://user:password@catalog.example.test/v1',
            'https://catalog.example.test/v1#fragment',
            'http://127.0.0.1:8080',
            'http://169.254.169.254/latest/meta-data/',
            'http://service.internal',
        ]) {
            assert.throws(
                () => validateCreateApiInput({ ...validApi, upstreamUrl }),
                (error: unknown) =>
                    error instanceof Error &&
                    'code' in error &&
                    error.code === 'INVALID_UPSTREAM_URL',
                upstreamUrl,
            );
        }
    } finally {
        if (priorMode === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = priorMode;
        if (priorOrigins === undefined) delete process.env.TEST_LOCAL_ALLOWED_ORIGINS;
        else process.env.TEST_LOCAL_ALLOWED_ORIGINS = priorOrigins;
    }
});

test('permits a local upstream only for an explicitly allowlisted dev origin', () => {
    const priorMode = process.env.NODE_ENV;
    const priorOrigins = process.env.TEST_LOCAL_ALLOWED_ORIGINS;
    process.env.NODE_ENV = 'test';
    process.env.TEST_LOCAL_ALLOWED_ORIGINS = 'http://127.0.0.1:4000';
    try {
        assert.equal(
            validateCreateApiInput({
                ...validApi,
                upstreamUrl: 'http://127.0.0.1:4000/api',
            }).upstreamUrl,
            'http://127.0.0.1:4000/api',
        );
    } finally {
        if (priorMode === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = priorMode;
        if (priorOrigins === undefined) delete process.env.TEST_LOCAL_ALLOWED_ORIGINS;
        else process.env.TEST_LOCAL_ALLOWED_ORIGINS = priorOrigins;
    }
});
