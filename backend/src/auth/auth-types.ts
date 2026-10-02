export interface GitHubUser {
    id: number;
    login: string;
    email: string | null;
    avatar_url: string;
}

export interface GitHubEmail {
    email: string;
    primary: boolean;
    verified: boolean;
    visibility: string | null;
}

export interface AuthenticatedUser {
    id: string;
    githubId: number;
    githubUsername: string;
    email: string | null;
    avatarUrl: string | null;
    status: 'ACTIVE' | 'DELETED' | 'ADMIN_DISABLED';
    isAdmin: boolean;
}

export interface AuthenticatedRequest {
    user: AuthenticatedUser;
}