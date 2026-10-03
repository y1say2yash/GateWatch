import type { Request, Response } from 'express';

import { deleteUserAccount, getUserProfile } from './user-service.js';

export async function getCurrentUserProfile(
    _request: Request,
    response: Response,
): Promise<void> {
    try {
        const user = await getUserProfile(response.locals.user);

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
    _request: Request,
    response: Response,
): Promise<void> {
    try {
        await deleteUserAccount(response.locals.user);

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