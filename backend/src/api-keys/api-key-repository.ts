
import database from '../config/database.js';

import type { ApiKey } from './api-key-types.js';

interface ApiKeyRow {
    id: string;
    api_id: string;
    name: string;
    key_prefix: string | null;
    key_hash: string;
    last_used_at: Date | null;
    created_at: Date;
    revoked_at: Date | null;
}

function mapApiKey(row: ApiKeyRow): ApiKey {
    return {
        id: row.id,
        apiId: row.api_id,
        name: row.name,
        keyPrefix: row.key_prefix ?? '',
        lastUsedAt: row.last_used_at?.toISOString() ?? null,
        createdAt: row.created_at.toISOString(),
        revokedAt: row.revoked_at?.toISOString() ?? null,
    };
}

export async function createApiKeyRecord(input: {
    apiId: string;
    name: string;
    keyPrefix: string;
    keyHash: string;
}): Promise<ApiKey> {
    const [row] = await database<ApiKeyRow>('api_keys')
        .insert({
            api_id: input.apiId,
            name: input.name,
            key_prefix: input.keyPrefix,
            key_hash: input.keyHash,
        })
        .returning('*');

    return mapApiKey(row);
}

export async function listApiKeyRecords(
    apiId: string,
): Promise<ApiKey[]> {
    const rows = await database<ApiKeyRow>('api_keys')
        .where({ api_id: apiId })
        .orderBy('created_at', 'desc')
        .select('*');

    return rows.map(mapApiKey);
}

export async function revokeApiKeyRecord(
    apiId: string,
    apiKeyId: string,
): Promise<boolean> {
    const updatedRows = await database<ApiKeyRow>('api_keys')
        .where({
            api_id: apiId,
            id: apiKeyId,
        })
        .whereNull('revoked_at')
        .update({
            revoked_at: database.fn.now(),
        });

    return updatedRows > 0;
}

export async function findActiveApiKeyByHash(
    keyHash: string,
): Promise<{
    id: string;
    apiId: string;
} | null> {
    const row = await database<ApiKeyRow>('api_keys')
        .where({
            key_hash: keyHash,
        })
        .whereNull('revoked_at')
        .select('id', 'api_id')
        .first();

    if (!row) {
        return null;
    }

    return {
        id: row.id,
        apiId: row.api_id,
    };
}

export async function updateApiKeyLastUsed(
    apiKeyId: string,
): Promise<void> {
    await database('api_keys')
        .where({
            id: apiKeyId,
        })
        .whereNull('revoked_at')
        .update({
            last_used_at: database.fn.now(),
        });
}
