import {
    createCipheriv,
    createDecipheriv,
    randomBytes,
} from 'node:crypto';

import type {
    TestAuthentication,
    TestAuthenticationType,
} from './test-types.js';

interface EncryptedSecret {
    iv: string;
    tag: string;
    ciphertext: string;
}

type StoredAuthentication = {
    type: TestAuthenticationType;
    username?: string;
    name?: string;
    secret?: EncryptedSecret;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAuthenticationType(
    value: string,
): value is TestAuthenticationType {
    return value === 'NONE' ||
        value === 'BASIC' ||
        value === 'BEARER' ||
        value === 'API_KEY';
}

function isEncryptedSecret(value: unknown): value is EncryptedSecret {
    return isRecord(value) &&
        typeof value.iv === 'string' &&
        typeof value.tag === 'string' &&
        typeof value.ciphertext === 'string';
}

function parseStoredAuthentication(value: unknown): StoredAuthentication | null {
    let parsed = value;
    if (typeof parsed === 'string') {
        try {
            parsed = JSON.parse(parsed) as unknown;
        } catch {
            return null;
        }
    }
    if (!isRecord(parsed) || typeof parsed.type !== 'string') {
        return null;
    }

    const type = parsed.type;
    if (!isAuthenticationType(type)) {
        return null;
    }
    const secret = parsed.secret;
    if (secret !== undefined && !isEncryptedSecret(secret)) {
        return null;
    }
    if (parsed.username !== undefined && typeof parsed.username !== 'string') {
        return null;
    }
    if (parsed.name !== undefined && typeof parsed.name !== 'string') {
        return null;
    }

    return {
        type,
        ...(typeof parsed.username === 'string' && { username: parsed.username }),
        ...(typeof parsed.name === 'string' && { name: parsed.name }),
        ...(isEncryptedSecret(secret) && { secret }),
    };
}

function getEncryptionKey(): Buffer {
    const configured = process.env.TEST_CREDENTIAL_ENCRYPTION_KEY;
    if (!configured || !/^[0-9a-fA-F]{64}$/.test(configured)) {
        throw new Error(
            'TEST_CREDENTIAL_ENCRYPTION_KEY must be configured as 64 hexadecimal characters to store test credentials.',
        );
    }
    return Buffer.from(configured, 'hex');
}

function encryptSecret(value: string): EncryptedSecret {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
    const ciphertext = Buffer.concat([
        cipher.update(value, 'utf8'),
        cipher.final(),
    ]);
    return {
        iv: iv.toString('hex'),
        tag: cipher.getAuthTag().toString('hex'),
        ciphertext: ciphertext.toString('hex'),
    };
}

function decryptSecret(secret: EncryptedSecret): string {
    const iv = Buffer.from(secret.iv, 'hex');
    const tag = Buffer.from(secret.tag, 'hex');
    const ciphertext = Buffer.from(secret.ciphertext, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
    decipher.setAuthTag(tag);
    const output = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
    ]);
    return output.toString('utf8');
}

export function decryptAuthentication(
    value: unknown,
): Record<string, unknown> | null {
    const stored = parseStoredAuthentication(value);
    if (!stored) {
        return null;
    }

    if (stored.type === 'NONE') {
        return { type: 'NONE' };
    }

    if (!stored.secret) {
        return null;
    }

    if (stored.type === 'BASIC') {
        return {
            type: 'BASIC',
            username: stored.username ?? '',
            password: decryptSecret(stored.secret),
        };
    }
    if (stored.type === 'BEARER') {
        return {
            type: 'BEARER',
            token: decryptSecret(stored.secret),
        };
    }
    if (stored.type === 'API_KEY') {
        return {
            type: 'API_KEY',
            name: stored.name ?? '',
            value: decryptSecret(stored.secret),
        };
    }
    return { type: 'NONE' };
}

export function protectAuthentication(
    authentication: Record<string, unknown>,
    existing?: StoredAuthentication | null,
): StoredAuthentication {
    const type = authentication.type as TestAuthenticationType;
    if (type === 'NONE') {
        return { type };
    }

    const sameType = existing?.type === type ? existing : undefined;
    const stored: StoredAuthentication = { type };
    if (type === 'BASIC') {
        stored.username = authentication.username as string;
        const password = authentication.password;
        const secret = typeof password === 'string'
            ? encryptSecret(password)
            : sameType?.secret;
        if (!secret) {
            throw new Error('Basic authentication password is required.');
        }
        stored.secret = secret;
        return stored;
    }
    if (type === 'BEARER') {
        const token = authentication.token;
        const secret = typeof token === 'string'
            ? encryptSecret(token)
            : sameType?.secret;
        if (!secret) {
            throw new Error('Bearer token is required.');
        }
        stored.secret = secret;
        return stored;
    }

    stored.name = authentication.name as string;
    const value = authentication.value;
    const secret = typeof value === 'string'
        ? encryptSecret(value)
        : sameType?.secret;
    if (!secret) {
        throw new Error('API-key value is required.');
    }
    stored.secret = secret;
    return stored;
}

export function describeAuthentication(
    value: unknown,
): TestAuthentication {
    const stored = parseStoredAuthentication(value);
    if (!stored) {
        return { type: 'NONE', credentialConfigured: false };
    }

    return {
        type: stored.type,
        ...(stored.username !== undefined && { username: stored.username }),
        ...(stored.name !== undefined && { name: stored.name }),
        credentialConfigured: Boolean(stored.secret),
    };
}

export function storedAuthentication(
    value: unknown,
): StoredAuthentication | null {
    return parseStoredAuthentication(value);
}
