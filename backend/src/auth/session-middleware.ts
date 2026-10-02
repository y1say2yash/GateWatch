import type { NextFunction, Request, Response } from 'express';

import {
    SESSION_COOKIE_NAME,
    getAuthenticatedUser,
} from './session-service.js';

export interface AuthenticatedRequest extends Request {
    user: NonNullable<Awaited<ReturnType<typeof getAuthenticatedUser>>>;
}

export async function requireAuthentication(
    request: Request,
    response: Response,
    next: NextFunction,
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
            response.clearCookie(SESSION_COOKIE_NAME, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                path: '/',
            });

            response.status(401).json({
                error: {
                    code: 'INVALID_SESSION',
                    message: 'Session is invalid or expired.',
                },
            });

            return;
        }

        (request as AuthenticatedRequest).user = user;

        next();
    } catch (error) {
        console.error('Session authentication failed:', error);

        response.status(500).json({
            error: {
                code: 'SESSION_AUTHENTICATION_FAILED',
                message: 'Failed to authenticate session.',
            },
        });
    }
}