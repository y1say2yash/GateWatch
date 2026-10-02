import crypto from 'node:crypto';

import database from '../config/database.js';
import type { AuthenticatedUser } from './auth-types.js';

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export const SESSION_COOKIE_NAME = 'gatewatch_session';

function hashSessionToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function mapUser(row: {
    id: string;
    github_id: number;
    github_username: string;
    email: string | null;
    avatar_url: string | null;
    status: 'ACTIVE' | 'DELETED' | 'ADMIN_DISABLED';
    is_admin: boolean;
}): AuthenticatedUser {
    return {
        id: row.id,
        githubId: Number(row.github_id),
        githubUsername: row.github_username,
        email: row.email,
        avatarUrl: row.avatar_url,
        status: row.status,
        isAdmin: row.is_admin,
    };
}

export async function getAuthenticatedUser(
    sessionToken: string,
): Promise<AuthenticatedUser | null> {
    const tokenHash = hashSessionToken(sessionToken);

    const row = await database('sessions')
        .join('users', 'users.id', 'sessions.user_id')
        .select(
            'sessions.id as session_id',
            'sessions.expires_at',
            'sessions.revoked_at',
            'users.id',
            'users.github_id',
            'users.github_username',
            'users.email',
            'users.avatar_url',
            'users.status',
            'users.is_admin',
            'users.deleted_at',
        )
        .where('sessions.token_hash', tokenHash)
        .first();

    if (!row) {
        return null;
    }

    if (row.revoked_at) {
        return null;
    }

    if (new Date(row.expires_at).getTime() <= Date.now()) {
        await revokeSessionById(row.session_id);
        return null;
    }

    if (row.deleted_at) {
        return null;
    }

    if (row.status !== 'ACTIVE') {
        return null;
    }

    return mapUser(row);
}

export async function revokeSession(sessionToken: string): Promise<void> {
    const tokenHash = hashSessionToken(sessionToken);

    await database('sessions')
        .where('token_hash', tokenHash)
        .whereNull('revoked_at')
        .update({
            revoked_at: database.fn.now(),
        });
}

export async function revokeSessionById(sessionId: string): Promise<void> {
    await database('sessions')
        .where('id', sessionId)
        .whereNull('revoked_at')
        .update({
            revoked_at: database.fn.now(),
        });
}

export async function revokeAllUserSessions(
    userId: string,
): Promise<void> {
    await database('sessions')
        .where('user_id', userId)
        .whereNull('revoked_at')
        .update({
            revoked_at: database.fn.now(),
        });
}

export async function cleanupExpiredSessions(): Promise<number> {
    const result = await database('sessions')
        .where('expires_at', '<=', database.fn.now())
        .whereNull('revoked_at')
        .update({
            revoked_at: database.fn.now(),
        });

    return result;
}