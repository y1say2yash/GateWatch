import type { NextFunction, Request, Response } from 'express';

import { authenticateAccessToken } from './access-token-service.js';
import { requireAuthentication } from './session-middleware.js';

export async function requireSessionOrAccessToken(
    request: Request,
    response: Response,
    next: NextFunction,
): Promise<void> {
    const authorization = request.get('authorization');
    if (authorization === undefined) {
        await requireAuthentication(request, response, next);
        return;
    }

    const match = /^Bearer[ \t]+([A-Za-z0-9_-]+)$/i.exec(authorization.trim());
    if (!match) {
        response.status(401).json({
            error: {
                code: 'INVALID_ACCESS_TOKEN',
                message: 'The supplied access token is invalid.',
            },
        });
        return;
    }

    try {
        const user = await authenticateAccessToken(match[1]);
        if (!user) {
            response.status(401).json({
                error: {
                    code: 'INVALID_ACCESS_TOKEN',
                    message: 'The supplied access token is invalid or expired.',
                },
            });
            return;
        }

        response.locals.user = user;
        response.locals.authenticationMethod = 'ACCESS_TOKEN';
        next();
    } catch (error) {
        console.error('Access-token authentication failed:', error);
        response.status(500).json({
            error: {
                code: 'ACCESS_TOKEN_AUTHENTICATION_FAILED',
                message: 'Failed to authenticate access token.',
            },
        });
    }
}
