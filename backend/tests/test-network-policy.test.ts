import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    areResolvedAddressesSafe,
    isDevelopmentLocalOriginAllowed,
    isNonPublicAddress,
} from '../src/tests/test-network-policy.js';

test('classifies special-use IPv4 and IPv6 destinations as non-public', () => {
    for (const address of [
        '0.0.0.0',
        '10.0.0.1',
        '100.64.0.1',
        '127.0.0.1',
        '169.254.169.254',
        '172.16.0.1',
        '192.0.2.1',
        '198.18.0.1',
        '198.51.100.1',
        '203.0.113.1',
        '224.0.0.1',
        '255.255.255.255',
        '::',
        '::1',
        '::ffff:127.0.0.1',
        '::ffff:169.254.169.254',
        'fc00::1',
        'fe80::1',
        'ff02::1',
        '2001:db8::1',
        '2002:0808:0808::1',
        '3fff::1',
        '64:ff9b::a9fe:a9fe',
        '64:ff9b:1::a9fe:a9fe',
    ]) {
        assert.equal(isNonPublicAddress(address), true, `${address} must be non-public`);
    }

    assert.equal(isNonPublicAddress('8.8.8.8'), false);
    assert.equal(isNonPublicAddress('2606:4700:4700::1111'), false);
    assert.equal(isNonPublicAddress('::ffff:8.8.8.8'), false);
});

test('rejects empty and mixed public/private DNS answers', () => {
    assert.equal(areResolvedAddressesSafe([], false), false);
    assert.equal(areResolvedAddressesSafe(['not-an-address'], true), false);
    assert.equal(areResolvedAddressesSafe(['8.8.8.8', '127.0.0.1'], false), false);
    assert.equal(areResolvedAddressesSafe(['8.8.8.8', '127.0.0.1'], true), false);
    assert.equal(areResolvedAddressesSafe(['8.8.8.8', '1.1.1.1'], false), true);
    assert.equal(areResolvedAddressesSafe(['127.0.0.1', '::1'], true), true);
});

test('requires an exact local-origin allowlist outside production', () => {
    const priorMode = process.env.NODE_ENV;
    const priorOrigins = process.env.TEST_LOCAL_ALLOWED_ORIGINS;
    process.env.NODE_ENV = 'test';
    process.env.TEST_LOCAL_ALLOWED_ORIGINS = 'http://127.0.0.1:40000';
    try {
        assert.equal(
            isDevelopmentLocalOriginAllowed(new URL('http://127.0.0.1:40000/path')),
            true,
        );
        assert.equal(
            isDevelopmentLocalOriginAllowed(new URL('http://127.0.0.1:40001/path')),
            false,
        );
        process.env.NODE_ENV = 'production';
        assert.equal(
            isDevelopmentLocalOriginAllowed(new URL('http://127.0.0.1:40000/path')),
            false,
        );
    } finally {
        if (priorMode === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = priorMode;
        if (priorOrigins === undefined) delete process.env.TEST_LOCAL_ALLOWED_ORIGINS;
        else process.env.TEST_LOCAL_ALLOWED_ORIGINS = priorOrigins;
    }
});

test('does not allow missing, empty, malformed, or non-development local origin entries', () => {
    const priorMode = process.env.NODE_ENV;
    const priorOrigins = process.env.TEST_LOCAL_ALLOWED_ORIGINS;
    const target = new URL('http://127.0.0.1:40000/path');
    try {
        process.env.NODE_ENV = 'development';
        for (const value of [
            undefined,
            '',
            ' , ',
            'http://127.0.0.1:40000/path',
            'http://user@127.0.0.1:40000',
            'http://127.0.0.1:40000?query=1',
            'http://127.0.0.1:40000#fragment',
            '*',
        ]) {
            if (value === undefined) delete process.env.TEST_LOCAL_ALLOWED_ORIGINS;
            else process.env.TEST_LOCAL_ALLOWED_ORIGINS = value;
            assert.equal(isDevelopmentLocalOriginAllowed(target), false, String(value));
        }

        process.env.TEST_LOCAL_ALLOWED_ORIGINS =
            ' http://127.0.0.1:40000 , ,not-an-origin ';
        assert.equal(isDevelopmentLocalOriginAllowed(target), true);

        process.env.NODE_ENV = 'production';
        process.env.TEST_LOCAL_ALLOWED_ORIGINS = 'http://127.0.0.1:40000';
        assert.equal(isDevelopmentLocalOriginAllowed(target), false);
        process.env.NODE_ENV = 'test';
        assert.equal(isDevelopmentLocalOriginAllowed(target), true);
        process.env.NODE_ENV = 'staging';
        assert.equal(isDevelopmentLocalOriginAllowed(target), false);
    } finally {
        if (priorMode === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = priorMode;
        if (priorOrigins === undefined) delete process.env.TEST_LOCAL_ALLOWED_ORIGINS;
        else process.env.TEST_LOCAL_ALLOWED_ORIGINS = priorOrigins;
    }
});
