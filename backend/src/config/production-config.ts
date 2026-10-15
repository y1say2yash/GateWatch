import { isValidTestCredentialEncryptionKey } from '../tests/test-credential-key.js';

export function assertProductionConfiguration(
    environment: NodeJS.ProcessEnv = process.env,
): void {
    if (environment.NODE_ENV !== 'production') {
        return;
    }

    const required = [
        'POSTGRES_PASSWORD',
        'GITHUB_CLIENT_ID',
        'GITHUB_CLIENT_SECRET',
    ] as const;
    const missing = required.filter((name) => !environment[name]?.trim());
    if (missing.length > 0) {
        throw new Error(`Required production configuration is missing: ${missing.join(', ')}.`);
    }
    if (!isValidTestCredentialEncryptionKey(environment.TEST_CREDENTIAL_ENCRYPTION_KEY)) {
        throw new Error(
            'TEST_CREDENTIAL_ENCRYPTION_KEY must be configured as 64 hexadecimal characters in production.',
        );
    }
}
