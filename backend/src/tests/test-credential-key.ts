export class TestCredentialEncryptionConfigurationError extends Error {
    constructor() {
        super(
            'TEST_CREDENTIAL_ENCRYPTION_KEY must be configured as 64 hexadecimal characters to store test credentials.',
        );
        this.name = 'TestCredentialEncryptionConfigurationError';
    }
}

export class TestCredentialDecryptionError extends Error {
    constructor() {
        super('Stored test credentials could not be decrypted with the configured key.');
        this.name = 'TestCredentialDecryptionError';
    }
}

export function isValidTestCredentialEncryptionKey(
    value: unknown,
): value is string {
    return typeof value === 'string' && /^[0-9a-fA-F]{64}$/.test(value);
}

export function getTestCredentialEncryptionKey(
    value: string | undefined,
): Buffer {
    if (!isValidTestCredentialEncryptionKey(value)) {
        throw new TestCredentialEncryptionConfigurationError();
    }
    return Buffer.from(value, 'hex');
}
