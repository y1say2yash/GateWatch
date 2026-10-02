import type { Request, Response } from 'express';

import { deleteUserAccount, getUserProfile } from './user-service.js';
import type { AuthenticatedRequest } from '../auth/session-middleware.js';

export async function getCurrentUserProfile(
    request: Request,
    response: Response,
): Promise<void> {
    try {
        const authenticatedRequest = request as AuthenticatedRequest;

        const user = await getUserProfile(authenticatedRequest.user);

        response.status(200).json({
            data: user,
        });
    } catch (error) {
        console.error('Failed to get user profile:', error);

        response.status(500).json({
            error: {
                code: 'USER_PROFILE_FETCH_FAILED',
                message: 'Failed to retrieve user profile.',
            },
        });
    }
}

export async function deleteCurrentUser(
    request: Request,
    response: Response,
): Promise<void> {
    try {
        const authenticatedRequest = request as AuthenticatedRequest;

        await deleteUserAccount(authenticatedRequest.user);

        response.clearCookie('gatewatch_session', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
        });

        response.status(204).send();
    } catch (error) {
        console.error('Failed to delete user account:', error);

        response.status(500).json({
            error: {
                code: 'USER_ACCOUNT_DELETE_FAILED',
                message:
                    error instanceof Error
                        ? error.message
                        : 'Failed to delete user account.',
            },
        });
    }
}