import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    decryptAuthentication,
    describeAuthentication,
    protectAuthentication,
} from '../src/tests/test-credentials.js';
import {
    TestCredentialDecryptionError,
    TestCredentialEncryptionConfigurationError,
} from '../src/tests/test-credential-key.js';

const testKey = 'a'.repeat(64);

function withCredentialKey(
    key: string | undefined,
    run: () => void,
): void {
    const previous = process.env.TEST_CREDENTIAL_ENCRYPTION_KEY;
    if (key === undefined) delete process.env.TEST_CREDENTIAL_ENCRYPTION_KEY;
    else process.env.TEST_CREDENTIAL_ENCRYPTION_KEY = key;
    try {
        run();
    } finally {
        if (previous === undefined) delete process.env.TEST_CREDENTIAL_ENCRYPTION_KEY;
        else process.env.TEST_CREDENTIAL_ENCRYPTION_KEY = previous;
    }
}

test('refuses to store credentials when the encryption key is missing or malformed', () => {
    for (const key of [undefined, '', 'not-hex', 'a'.repeat(63), `${'a'.repeat(63)}g`]) {
        withCredentialKey(key, () => {
            assert.throws(
                () => protectAuthentication({
                    type: 'BEARER',
                    token: 'test-only-token',
                }),
                (error: unknown) =>
                    error instanceof Error &&
                    /64 hexadecimal characters/.test(error.message) &&
                    (!key || !error.message.includes(key)),
            );
        });
    }
});

test('allows definitions without credentials when no encryption key is configured', () => {
    withCredentialKey(undefined, () => {
        assert.deepEqual(protectAuthentication({ type: 'NONE' }), { type: 'NONE' });
        assert.deepEqual(decryptAuthentication({ type: 'NONE' }), { type: 'NONE' });
    });
});

test('stores credentials as authenticated ciphertext and decrypts them only with the configured key', () => {
    withCredentialKey(testKey, () => {
        const stored = protectAuthentication({
            type: 'BEARER',
            token: 'test-only-token',
        });
        const serialized = JSON.stringify(stored);

        assert.equal(serialized.includes('test-only-token'), false);
        assert.deepEqual(describeAuthentication(stored), {
            type: 'BEARER',
            credentialConfigured: true,
        });
        assert.deepEqual(decryptAuthentication(stored), {
            type: 'BEARER',
            token: 'test-only-token',
        });

        withCredentialKey(undefined, () => {
            assert.throws(
                () => decryptAuthentication(stored),
                TestCredentialEncryptionConfigurationError,
            );
        });
        withCredentialKey('b'.repeat(64), () => {
            assert.throws(
                () => decryptAuthentication(stored),
                TestCredentialDecryptionError,
            );
        });
    });
});
