import type { Request, Response } from 'express';

import {
    AuditLogWriteError,
    getAuditActorRole,
    sendAuditLogFailure,
    writeAuditLog,
} from '../audit/audit-service.js';
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
            await writeAuditLog({
                actorUserId: null,
                actorRole: null,
                action: 'AUTHENTICATION_FAILED',
                resourceType: 'SESSION',
                metadata: { reason: 'OAUTH_ACCESS_DENIED' },
                ipAddress: request.socket.remoteAddress,
            });
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
            await writeAuditLog({
                actorUserId: null,
                actorRole: null,
                action: 'AUTHENTICATION_FAILED',
                resourceType: 'SESSION',
                metadata: { reason: 'OAUTH_INVALID_STATE' },
                ipAddress: request.socket.remoteAddress,
            });
            response.status(400).json({
                error: {
                    code: 'OAUTH_INVALID_STATE',
                    message: 'Invalid or expired OAuth state.',
                },
            });

            return;
        }

        const { sessionToken, user } = await authenticateWithGitHub(
            code as string,
        );
        await writeAuditLog({
            actorUserId: user.id,
            actorRole: getAuditActorRole(user.isAdmin),
            action: 'AUTHENTICATION_SUCCEEDED',
            resourceType: 'SESSION',
            ipAddress: request.socket.remoteAddress,
        });

        response.cookie(SESSION_COOKIE_NAME, sessionToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: SESSION_TTL_SECONDS * 1000,
            path: '/',
        });

        response.redirect('/');
    } catch (error) {
        if (sendAuditLogFailure(error, response)) {
            return;
        }
        console.error('GitHub OAuth callback failed:', error);

        try {
            await writeAuditLog({
                actorUserId: null,
                actorRole: null,
                action: 'AUTHENTICATION_FAILED',
                resourceType: 'SESSION',
                metadata: { reason: 'OAUTH_CALLBACK_FAILED' },
                ipAddress: request.socket.remoteAddress,
            });
        } catch (auditError) {
            if (sendAuditLogFailure(auditError, response)) {
                return;
            }
            response.status(503).json({
                error: {
                    code: 'AUDIT_LOG_UNAVAILABLE',
                    message: 'Audit logging is temporarily unavailable.',
                },
            });
            return;
        }

        response.status(500).json({
            error: {
                code: 'OAUTH_AUTHENTICATION_FAILED',
                message: 'GitHub authentication failed.',
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
            const user = await getAuthenticatedUser(sessionToken);
            await revokeSession(sessionToken);
            if (user) {
                await writeAuditLog({
                    actorUserId: user.id,
                    actorRole: getAuditActorRole(user.isAdmin),
                    action: 'LOGOUT',
                    resourceType: 'SESSION',
                    ipAddress: request.socket.remoteAddress,
                });
            } else {
                await writeAuditLog({
                    actorUserId: null,
                    actorRole: null,
                    action: 'AUTHENTICATION_FAILED',
                    resourceType: 'SESSION',
                    metadata: { reason: 'LOGOUT_INVALID_SESSION' },
                    ipAddress: request.socket.remoteAddress,
                });
            }
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
        if (error instanceof AuditLogWriteError) {
            response.clearCookie(SESSION_COOKIE_NAME, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                path: '/',
            });
            sendAuditLogFailure(error, response);
            return;
        }

        response.status(500).json({
            error: {
                code: 'LOGOUT_FAILED',
                message: 'Failed to log out.',
            },
        });
    }
}