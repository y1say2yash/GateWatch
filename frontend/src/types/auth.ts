export type AuthStatus = 'ACTIVE' | 'DELETED' | 'ADMIN_DISABLED';

export interface AuthenticatedUser {
  id: string;
  githubId: number;
  githubUsername: string;
  email: string | null;
  avatarUrl: string | null;
  status: AuthStatus;
  isAdmin: boolean;
}
