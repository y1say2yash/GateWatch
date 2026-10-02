import crypto from 'node:crypto';

import database from '../config/database.js';
import redis from '../config/redis.js';
import type {
    AuthenticatedUser,
    GitHubEmail,
    GitHubUser,
} from './auth-types.js';
import { SESSION_TTL_SECONDS } from './session-service.js';

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;

const GITHUB_REDIRECT_URI =
    process.env.GITHUB_REDIRECT_URI ??
    'http://localhost/api/v1/auth/github/callback';

const OAUTH_STATE_TTL_SECONDS = 60 * 10;

function requireGitHubConfig(): void {
    if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
        throw new Error('GitHub OAuth configuration is incomplete.');
    }
}

function generateOAuthState(): string {
    return crypto.randomBytes(32).toString('hex');
}

function generateSessionToken(): string {
    return crypto.randomBytes(32).toString('hex');
}

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

export async function createOAuthState(): Promise<string> {
    requireGitHubConfig();

    const state = generateOAuthState();

    await redis.set(`oauth:state:${state}`, 'valid', {
        EX: OAUTH_STATE_TTL_SECONDS,
    });

    return state;
}

export async function validateOAuthState(state: string): Promise<boolean> {
    const key = `oauth:state:${state}`;
    const value = await redis.get(key);

    if (!value) {
        return false;
    }

    await redis.del(key);

    return true;
}

export function buildGitHubAuthorizationUrl(state: string): string {
    requireGitHubConfig();

    const params = new URLSearchParams({
        client_id: GITHUB_CLIENT_ID!,
        redirect_uri: GITHUB_REDIRECT_URI,
        scope: 'read:user user:email',
        state,
    });

    return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

async function exchangeCodeForAccessToken(code: string): Promise<string> {
    requireGitHubConfig();

    const response = await fetch(
        'https://github.com/login/oauth/access_token',
        {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                client_id: GITHUB_CLIENT_ID,
                client_secret: GITHUB_CLIENT_SECRET,
                code,
                redirect_uri: GITHUB_REDIRECT_URI,
            }),
        },
    );

    if (!response.ok) {
        throw new Error(
            `GitHub token exchange failed with status ${response.status}.`,
        );
    }

    const data = (await response.json()) as {
        access_token?: string;
        error?: string;
        error_description?: string;
    };

    if (!data.access_token) {
        throw new Error(
            data.error_description ??
            data.error ??
            'GitHub did not return an access token.',
        );
    }

    return data.access_token;
}

async function fetchGitHubUser(
    accessToken: string,
): Promise<GitHubUser> {
    const response = await fetch('https://api.github.com/user', {
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${accessToken}`,
            'X-GitHub-Api-Version': '2022-11-28',
        },
    });

    if (!response.ok) {
        throw new Error(
            `GitHub user request failed with status ${response.status}.`,
        );
    }

    return (await response.json()) as GitHubUser;
}

async function fetchGitHubEmails(
    accessToken: string,
): Promise<GitHubEmail[]> {
    const response = await fetch('https://api.github.com/user/emails', {
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${accessToken}`,
            'X-GitHub-Api-Version': '2022-11-28',
        },
    });

    if (!response.ok) {
        throw new Error(
            `GitHub email request failed with status ${response.status}.`,
        );
    }

    return (await response.json()) as GitHubEmail[];
}

function resolvePrimaryEmail(
    user: GitHubUser,
    emails: GitHubEmail[],
): string | null {
    const primaryVerifiedEmail = emails.find(
        (email) => email.primary && email.verified,
    );

    if (primaryVerifiedEmail) {
        return primaryVerifiedEmail.email;
    }

    const verifiedEmail = emails.find((email) => email.verified);

    if (verifiedEmail) {
        return verifiedEmail.email;
    }

    return user.email;
}

async function findOrCreateUser(
    githubUser: GitHubUser,
    email: string | null,
): Promise<AuthenticatedUser> {
    const existingUser = await database('users')
        .where('github_id', githubUser.id)
        .first();

    if (existingUser) {
        if (existingUser.deleted_at) {
            throw new Error('This GateWatch account has been deleted.');
        }

        const [updatedUser] = await database('users')
            .where('id', existingUser.id)
            .update(
                {
                    github_username: githubUser.login,
                    email,
                    avatar_url: githubUser.avatar_url,
                    updated_at: database.fn.now(),
                },
                [
                    'id',
                    'github_id',
                    'github_username',
                    'email',
                    'avatar_url',
                    'status',
                    'is_admin',
                ],
            );

        return mapUser(updatedUser);
    }

    const [newUser] = await database('users')
        .insert({
            github_id: githubUser.id,
            github_username: githubUser.login,
            email,
            avatar_url: githubUser.avatar_url,
            status: 'ACTIVE',
            is_admin: false,
        })
        .returning([
            'id',
            'github_id',
            'github_username',
            'email',
            'avatar_url',
            'status',
            'is_admin',
        ]);

    return mapUser(newUser);
}

async function createSession(userId: string): Promise<string> {
    const sessionToken = generateSessionToken();
    const tokenHash = hashSessionToken(sessionToken);

    const expiresAt = new Date(
        Date.now() + SESSION_TTL_SECONDS * 1000,
    );

    await database('sessions').insert({
        user_id: userId,
        token_hash: tokenHash,
        expires_at: expiresAt,
    });

    return sessionToken;
}

export async function authenticateWithGitHub(
    code: string,
): Promise<{
    user: AuthenticatedUser;
    sessionToken: string;
}> {
    const githubAccessToken = await exchangeCodeForAccessToken(code);

    const githubUser = await fetchGitHubUser(githubAccessToken);

    const githubEmails = await fetchGitHubEmails(githubAccessToken);

    const email = resolvePrimaryEmail(githubUser, githubEmails);

    const user = await findOrCreateUser(githubUser, email);

    if (user.status === 'DELETED') {
        throw new Error('This GateWatch account has been deleted.');
    }

    if (user.status === 'ADMIN_DISABLED') {
        throw new Error('This GateWatch account has been disabled.');
    }

    const sessionToken = await createSession(user.id);

    return {
        user,
        sessionToken,
    };
}