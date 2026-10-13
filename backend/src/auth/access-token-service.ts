import { createHash, randomBytes } from 'node:crypto';
import type { Knex } from 'knex';

import database from '../config/database.js';
import type { AuthenticatedUser } from './auth-types.js';

export interface AccessToken {
    id: string;
    name: string;
    createdAt: string;
    expiresAt: string | null;
    lastUsedAt: string | null;
    revokedAt: string | null;
}

interface AccessTokenProjection {
    id: string;
    name: string;
    created_at: Date | string;
    expires_at: Date | string | null;
    last_used_at: Date | string | null;
    revoked_at: Date | string | null;
}

interface AccessTokenRow extends AccessTokenProjection {
    user_id: string;
    token_hash: string;
}

interface AuthenticatedAccessTokenRow {
    id: string;
    user_id: string;
    github_id: number | string;
    github_username: string;
    email: string | null;
    avatar_url: string | null;
    status: AuthenticatedUser['status'];
    is_admin: boolean;
    deleted_at: Date | string | null;
}

export class AccessTokenValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AccessTokenValidationError';
    }
}

export class AccessTokenNotFoundError extends Error {
    constructor() {
        super('Access token not found.');
        this.name = 'AccessTokenNotFoundError';
    }
}

function hashAccessToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

function toIsoString(value: Date | string | null): string | null {
    return value === null ? null : new Date(value).toISOString();
}

function mapAccessToken(row: AccessTokenProjection): AccessToken {
    return {
        id: row.id,
        name: row.name,
        createdAt: new Date(row.created_at).toISOString(),
        expiresAt: toIsoString(row.expires_at),
        lastUsedAt: toIsoString(row.last_used_at),
        revokedAt: toIsoString(row.revoked_at),
    };
}

function validateCreateInput(input: unknown): {
    name: string;
    expiresAt: Date | null;
} {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        throw new AccessTokenValidationError('Request body must be a JSON object.');
    }

    const value = input as Record<string, unknown>;
    if (typeof value.name !== 'string') {
        throw new AccessTokenValidationError('Access token name is required.');
    }
    const name = value.name.trim();
    if (name.length < 1 || name.length > 100) {
        throw new AccessTokenValidationError(
            'Access token name must contain between 1 and 100 characters.',
        );
    }

    if (value.expiresAt === undefined || value.expiresAt === null) {
        return { name, expiresAt: null };
    }
    if (typeof value.expiresAt !== 'string') {
        throw new AccessTokenValidationError(
            'Access token expiration must be an ISO 8601 timestamp.',
        );
    }
    const expiresAt = new Date(value.expiresAt);
    if (!Number.isFinite(expiresAt.getTime())) {
        throw new AccessTokenValidationError(
            'Access token expiration must be an ISO 8601 timestamp.',
        );
    }
    if (expiresAt.getTime() <= Date.now()) {
        throw new AccessTokenValidationError(
            'Access token expiration must be in the future.',
        );
    }
    return { name, expiresAt };
}

export async function createUserAccessToken(
    userId: string,
    input: unknown,
    transaction?: Knex.Transaction,
): Promise<{ accessToken: AccessToken; token: string }> {
    const { name, expiresAt } = validateCreateInput(input);
    const token = `gw_at_${randomBytes(32).toString('base64url')}`;
    const [row] = await (transaction ?? database)<AccessTokenRow>('access_tokens')
        .insert({
            user_id: userId,
            name,
            token_hash: hashAccessToken(token),
            expires_at: expiresAt,
        })
        .returning([
            'id',
            'name',
            'created_at',
            'expires_at',
            'last_used_at',
            'revoked_at',
        ]);

    return { accessToken: mapAccessToken(row), token };
}

export async function listUserAccessTokens(
    userId: string,
): Promise<AccessToken[]> {
    const rows = await database<AccessTokenRow>('access_tokens')
        .where({ user_id: userId })
        .orderBy('created_at', 'desc')
        .select(
            'id',
            'name',
            'created_at',
            'expires_at',
            'last_used_at',
            'revoked_at',
        );
    return rows.map(mapAccessToken);
}

export async function revokeUserAccessToken(
    userId: string,
    accessTokenId: string,
): Promise<void> {
    const updated = await database('access_tokens')
        .where({ id: accessTokenId, user_id: userId })
        .whereNull('revoked_at')
        .update({ revoked_at: database.fn.now() });
    if (updated === 0) {
        throw new AccessTokenNotFoundError();
    }
}

export async function authenticateAccessToken(
    token: string,
): Promise<AuthenticatedUser | null> {
    const row = await database<AuthenticatedAccessTokenRow>('access_tokens')
        .join('users', 'users.id', 'access_tokens.user_id')
        .where('access_tokens.token_hash', hashAccessToken(token))
        .whereNull('access_tokens.revoked_at')
        .whereNull('users.deleted_at')
        .where('users.status', 'ACTIVE')
        .where((query) => {
            query.whereNull('access_tokens.expires_at')
                .orWhere('access_tokens.expires_at', '>', database.fn.now());
        })
        .select(
            'access_tokens.id',
            'users.id as user_id',
            'users.github_id',
            'users.github_username',
            'users.email',
            'users.avatar_url',
            'users.status',
            'users.is_admin',
            'users.deleted_at',
        )
        .first();

    if (!row) {
        return null;
    }

    const updated = await database('access_tokens')
        .where({ id: row.id })
        .whereNull('revoked_at')
        .where((query) => {
            query.whereNull('expires_at')
                .orWhere('expires_at', '>', database.fn.now());
        })
        .update({ last_used_at: database.fn.now() });
    if (updated === 0) {
        return null;
    }

    return {
        id: row.user_id,
        githubId: Number(row.github_id),
        githubUsername: row.github_username,
        email: row.email,
        avatarUrl: row.avatar_url,
        status: row.status,
        isAdmin: row.is_admin,
    };
}
