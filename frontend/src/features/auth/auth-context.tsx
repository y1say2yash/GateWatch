/* eslint-disable react-refresh/only-export-components */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';

import { apiRequest, ApiError } from '../../lib/api';
import type { AuthenticatedUser } from '../../types/auth';

interface AuthContextValue {
  user: AuthenticatedUser | null;
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  loggingOut: boolean;
  restoreSession: () => Promise<void>;
  login: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }): ReactElement {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const navigate = useNavigate();

  const restoreSession = async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const data = await apiRequest<AuthenticatedUser>('/api/v1/auth/me');
      setUser(data);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
        setError(null);
      } else {
        setUser(null);
        setError(
          err instanceof ApiError
            ? err.message
            : 'Unable to reach the GateWatch server. Please try again.',
        );
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void restoreSession();
  }, []);

  const login = (): void => {
    window.location.assign('/api/v1/auth/github');
  };

  const logout = async (): Promise<void> => {
    setLoggingOut(true);
    setError(null);

    try {
      await apiRequest('/api/v1/auth/logout', { method: 'POST' });
      setUser(null);
      navigate('/login', { replace: true });
    } catch {
      setUser(null);
      setError('Logout could not be confirmed. Your GateWatch session may still be active. Please retry.');
      navigate('/login', { replace: true });
    } finally {
      setLoggingOut(false);
    }
  };

  const value: AuthContextValue = {
    user,
    loading,
    error,
    isAuthenticated: Boolean(user),
    loggingOut,
    restoreSession,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }

  return context;
}
