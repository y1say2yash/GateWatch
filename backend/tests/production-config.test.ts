import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertProductionConfiguration } from '../src/config/production-config.js';

const completeProductionEnvironment: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    POSTGRES_PASSWORD: 'deployment-secret',
    GITHUB_CLIENT_ID: 'github-client-id',
    GITHUB_CLIENT_SECRET: 'github-client-secret',
    TEST_CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
};

test('accepts complete production secret configuration', () => {
    assert.doesNotThrow(() => assertProductionConfiguration(completeProductionEnvironment));
});

test('refuses production startup when a required secret is absent or invalid', () => {
    for (const override of [
        { POSTGRES_PASSWORD: '' },
        { GITHUB_CLIENT_SECRET: '' },
        { TEST_CREDENTIAL_ENCRYPTION_KEY: undefined },
        { TEST_CREDENTIAL_ENCRYPTION_KEY: '' },
        { TEST_CREDENTIAL_ENCRYPTION_KEY: 'not-a-valid-key' },
        { TEST_CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(63) },
        { TEST_CREDENTIAL_ENCRYPTION_KEY: `${'a'.repeat(63)}g` },
    ]) {
        assert.throws(
            () => assertProductionConfiguration({
                ...completeProductionEnvironment,
                ...override,
            }),
            /production configuration|TEST_CREDENTIAL_ENCRYPTION_KEY/i,
        );
    }

    assert.doesNotThrow(() => assertProductionConfiguration({ NODE_ENV: 'development' }));
    assert.doesNotThrow(() => assertProductionConfiguration({
        NODE_ENV: 'development',
        TEST_CREDENTIAL_ENCRYPTION_KEY: 'invalid-but-unused',
    }));
});
