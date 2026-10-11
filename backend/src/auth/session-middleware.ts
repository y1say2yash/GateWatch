import type { NextFunction, Request, Response } from 'express';

import {
    sendAuditLogFailure,
    writeAuditLog,
} from '../audit/audit-service.js';
import {
    SESSION_COOKIE_NAME,
    getAuthenticatedUser,
} from './session-service.js';

export async function requireAuthentication(
    request: Request,
    response: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const sessionToken = request.cookies?.[SESSION_COOKIE_NAME];

        if (!sessionToken) {
            await writeAuditLog({
                actorUserId: null,
                actorRole: null,
                action: 'AUTHENTICATION_FAILED',
                resourceType: 'SESSION',
                metadata: { reason: 'SESSION_REQUIRED' },
                ipAddress: request.socket.remoteAddress,
            });
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
            response.clearCookie(SESSION_COOKIE_NAME, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                path: '/',
            });
            await writeAuditLog({
                actorUserId: null,
                actorRole: null,
                action: 'AUTHENTICATION_FAILED',
                resourceType: 'SESSION',
                metadata: { reason: 'INVALID_SESSION' },
                ipAddress: request.socket.remoteAddress,
            });

            response.status(401).json({
                error: {
                    code: 'INVALID_SESSION',
                    message: 'Session is invalid or expired.',
                },
            });

            return;
        }

        response.locals.user = user;

        next();
    } catch (error) {
        if (sendAuditLogFailure(error, response)) {
            return;
        }
        console.error('Session authentication failed:', error);

        response.status(500).json({
            error: {
                code: 'SESSION_AUTHENTICATION_FAILED',
                message: 'Failed to authenticate session.',
            },
        });
    }
}