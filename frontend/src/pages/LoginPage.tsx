import type { ReactElement } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { useAuth } from '../features/auth/auth-context';

export function LoginPage(): ReactElement {
  const { user, loading, error, login } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="page-state"><span className="loader" />Restoring session...</div>;
  }

  if (user) {
    const redirectTarget = (location.state as { from?: string } | null)?.from ?? '/dashboard';
    return <Navigate to={redirectTarget} replace />;
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <img
          className="login-logo"
          src="/assets/branding/gatewatch-logo.svg"
          alt="GateWatch"
          width="256"
          height="64"
        />
        <div className="eyebrow">Authorize access</div>
        <h1>Sign in to GateWatch</h1>
        <p>
          Continue with your GitHub account to manage gateways, monitoring, and API health.
        </p>
        {error && <p className="auth-error" role="alert">{error}</p>}

        <button type="button" className="primary-button" onClick={login}>
          Continue with GitHub
        </button>
      </div>
    </div>
  );
}
