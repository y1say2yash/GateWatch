export interface UserProfile {
    id: string;
    githubId: number;
    githubUsername: string;
    email: string | null;
    avatarUrl: string | null;
    status: 'ACTIVE' | 'DELETED' | 'ADMIN_DISABLED';
    isAdmin: boolean;
}