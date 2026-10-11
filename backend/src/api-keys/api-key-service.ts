
import { createHash, randomBytes } from 'node:crypto';

import { getUserApi } from '../apis/api-service.js';

import {
    createApiKeyRecord,
    findActiveApiKeyByHash,
    listApiKeyRecords,
    revokeApiKeyRecord,
    updateApiKeyLastUsed,
} from './api-key-repository.js';

import type {
    ApiKey,
    CreatedApiKey,
} from './api-key-types.js';

export class ApiKeyValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ApiKeyValidationError';
    }
}

export class ApiKeyNotFoundError extends Error {
    constructor() {
        super('API key not found.');
        this.name = 'ApiKeyNotFoundError';
    }
}

function hashApiKey(key: string): string {
    return createHash('sha256')
        .update(key)
        .digest('hex');
}

function validateKeyName(input: unknown): string {
    if (
        typeof input !== 'object' ||
        input === null ||
        Array.isArray(input)
    ) {
        throw new ApiKeyValidationError(
            'Request body must be a JSON object.',
        );
    }

    const name = (input as Record<string, unknown>).name;

    if (typeof name !== 'string') {
        throw new ApiKeyValidationError(
            'API key name is required.',
        );
    }

    const normalizedName = name.trim();

    if (normalizedName.length < 1 || normalizedName.length > 100) {
        throw new ApiKeyValidationError(
            'API key name must contain between 1 and 100 characters.',
        );
    }

    return normalizedName;
}

export async function createUserApiKey(
    userId: string,
    apiId: string,
    input: unknown,
): Promise<CreatedApiKey> {
    await getUserApi(userId, apiId);

    const name = validateKeyName(input);

    const secret = `gw_${randomBytes(32).toString('base64url')}`;
    const keyPrefix = secret.slice(0, 11);
    const keyHash = hashApiKey(secret);

    const apiKey = await createApiKeyRecord({
        apiId,
        name,
        keyPrefix,
        keyHash,
    });

    return {
        apiKey,
        key: secret,
    };
}

export async function listUserApiKeys(
    userId: string,
    apiId: string,
): Promise<ApiKey[]> {
    await getUserApi(userId, apiId);

    return listApiKeyRecords(apiId);
}

export async function revokeUserApiKey(
    userId: string,
    apiKeyId: string,
): Promise<void> {
    const apiKey = await findApiKeyOwnedByUser(
        userId,
        apiKeyId,
    );

    if (!apiKey) {
        throw new ApiKeyNotFoundError();
    }

    const revoked = await revokeApiKeyRecord(
        apiKey.apiId,
        apiKeyId,
    );

    if (!revoked) {
        throw new ApiKeyNotFoundError();
    }
}

async function findApiKeyOwnedByUser(
    userId: string,
    apiKeyId: string,
): Promise<{ apiId: string } | null> {
    // Resolve the key only through APIs belonging to the owner.
    const { default: database } = await import(
        '../config/database.js'
    );

    const row = await database('api_keys')
        .join('apis', 'apis.id', 'api_keys.api_id')
        .join('projects', 'projects.id', 'apis.project_id')
        .where({
            'api_keys.id': apiKeyId,
            'projects.user_id': userId,
        })
        .whereNull('api_keys.revoked_at')
        .whereNull('apis.deleted_at')
        .whereNull('projects.deleted_at')
        .select('api_keys.api_id as apiId')
        .first();

    return row ? { apiId: row.apiId as string } : null;
}

export async function authenticateApiKey(
    secret: string,
): Promise<{ id: string; apiId: string } | null> {
    const key = await findActiveApiKeyByHash(
        hashApiKey(secret),
    );

    if (!key) {
        return null;
    }

    await updateApiKeyLastUsed(key.id);

    return key;
}
