import database from '../config/database.js';
import type { AuthenticatedUser } from '../auth/auth-types.js';
import type { UserProfile } from './user-types.js';

function mapUser(user: AuthenticatedUser): UserProfile {
    return {
        id: user.id,
        githubId: user.githubId,
        githubUsername: user.githubUsername,
        email: user.email,
        avatarUrl: user.avatarUrl,
        status: user.status,
        isAdmin: user.isAdmin,
    };
}

export async function getUserProfile(
    user: AuthenticatedUser,
): Promise<UserProfile> {
    return mapUser(user);
}

export async function deleteUserAccount(
    user: AuthenticatedUser,
): Promise<void> {
    await database.transaction(async (transaction) => {
        const updatedRows = await transaction('users')
            .where('id', user.id)
            .whereNull('deleted_at')
            .where('status', 'ACTIVE')
            .update({
                status: 'DELETED',
                deleted_at: transaction.fn.now(),
                updated_at: transaction.fn.now(),
            });

        if (updatedRows === 0) {
            throw new Error('User account is already deleted or unavailable.');
        }

        await transaction('sessions')
            .where('user_id', user.id)
            .whereNull('revoked_at')
            .update({
                revoked_at: transaction.fn.now(),
            });
    });
}