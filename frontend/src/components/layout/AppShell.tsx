import type { ReactElement, ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

import { useAuth } from '../../features/auth/auth-context';
import type { AuthenticatedUser } from '../../types/auth';

interface AppShellProps {
  user: AuthenticatedUser;
  children: ReactNode;
}

const navItems = [
  { to: '/dashboard', label: 'Overview' },
  { to: '/apis', label: 'APIs' },
  { to: '/monitoring', label: 'Monitoring' },
  { to: '/settings', label: 'Settings' },
];

export function AppShell({ user, children }: AppShellProps): ReactElement {
  const { error, loggingOut, logout } = useAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">GW</div>
          <div>
            <div className="brand-name">GateWatch</div>
            <div className="brand-subtitle">Gateway Control</div>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Main navigation">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `sidebar-link${isActive ? ' active' : ''}`
              }
              end={item.to === '/dashboard'}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="avatar-badge" aria-label="User profile">
            {user.githubUsername.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <p className="user-name">{user.githubUsername}</p>
            <p className="user-role">{user.isAdmin ? 'Administrator' : 'Member'}</p>
          </div>
          <button
            type="button"
            className="sidebar-logout"
            onClick={() => void logout()}
            disabled={loggingOut}
            aria-label={loggingOut ? 'Logging out' : 'Logout'}
          >
            {loggingOut ? 'Logging out…' : 'Logout'}
          </button>
        </div>
      </aside>

      <main className="content-panel">
        {error && <p className="auth-error" role="alert">{error}</p>}
        {children}
      </main>
    </div>
  );
}
