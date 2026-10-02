import type { Request, Response } from 'express';

import {
    authenticateWithGitHub,
    buildGitHubAuthorizationUrl,
    createOAuthState,
    validateOAuthState,
} from './auth-service.js';
import {
    getAuthenticatedUser,
    revokeSession,
    SESSION_COOKIE_NAME,
    SESSION_TTL_SECONDS,
} from './session-service.js';
import { validateOAuthCallback } from './auth-validation.js';

export async function githubLogin(
    _request: Request,
    response: Response,
): Promise<void> {
    const state = await createOAuthState();

    const authorizationUrl = buildGitHubAuthorizationUrl(state);

    response.redirect(authorizationUrl);
}

export async function githubCallback(
    request: Request,
    response: Response,
): Promise<void> {
    try {
        const { code, state, error, error_description } = request.query;

        if (error) {
            response.status(400).json({
                error: {
                    code: 'OAUTH_ACCESS_DENIED',
                    message:
                        typeof error_description === 'string'
                            ? error_description
                            : 'GitHub authorization was denied.',
                },
            });

            return;
        }

        validateOAuthCallback(
            typeof code === 'string' ? code : undefined,
            typeof state === 'string' ? state : undefined,
        );

        const validState = await validateOAuthState(state as string);

        if (!validState) {
            response.status(400).json({
                error: {
                    code: 'OAUTH_INVALID_STATE',
                    message: 'Invalid or expired OAuth state.',
                },
            });

            return;
        }

        const { sessionToken } = await authenticateWithGitHub(
            code as string,
        );

        response.cookie(SESSION_COOKIE_NAME, sessionToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: SESSION_TTL_SECONDS * 1000,
            path: '/',
        });

        response.redirect('/');
    } catch (error) {
        console.error('GitHub OAuth callback failed:', error);

        response.status(500).json({
            error: {
                code: 'OAUTH_AUTHENTICATION_FAILED',
                message:
                    error instanceof Error
                        ? error.message
                        : 'GitHub authentication failed.',
            },
        });
    }
}

export async function getCurrentUser(
    request: Request,
    response: Response,
): Promise<void> {
    try {
        const sessionToken = request.cookies?.[SESSION_COOKIE_NAME];

        if (!sessionToken) {
            response.status(401).json({
                error: {
                    code: 'AUTHENTICATION_REQUIRED',
                    message: 'Authentication is required.',
                },
            });

            return;
        }

        const user = await getAuthenticatedUser(sessionToken);

        if (!user) {
            response.status(401).json({
                error: {
                    code: 'INVALID_SESSION',
                    message: 'Session is invalid or expired.',
                },
            });

            return;
        }

        response.status(200).json({
            data: user,
        });
    } catch (error) {
        console.error('Failed to get current user:', error);

        response.status(500).json({
            error: {
                code: 'AUTHENTICATION_CHECK_FAILED',
                message: 'Failed to retrieve authenticated user.',
            },
        });
    }
}

export async function logout(
    request: Request,
    response: Response,
): Promise<void> {
    try {
        const sessionToken = request.cookies?.[SESSION_COOKIE_NAME];

        if (sessionToken) {
            await revokeSession(sessionToken);
        }

        response.clearCookie(SESSION_COOKIE_NAME, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
        });

        response.status(204).send();
    } catch (error) {
        console.error('Logout failed:', error);

        response.status(500).json({
            error: {
                code: 'LOGOUT_FAILED',
                message: 'Failed to log out.',
            },
        });
    }
}