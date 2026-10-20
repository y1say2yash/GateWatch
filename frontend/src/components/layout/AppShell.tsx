import { useState, type ReactElement, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

import { useAuth } from '../../features/auth/auth-context';
import type { AuthenticatedUser } from '../../types/auth';

interface AppShellProps {
  user: AuthenticatedUser;
  children: ReactNode;
}

const navItems = [
  { to: '/dashboard', label: 'Overview' },
  { to: '/projects', label: 'Projects' },
  { to: '/apis', label: 'APIs' },
  { to: '/testing', label: 'Testing' },
  { to: '/monitoring', label: 'Monitoring' },
  { to: '/alerts', label: 'Alerts' },
  { to: '/settings', label: 'Settings' },
];

export function AppShell({ user, children }: AppShellProps): ReactElement {
  const { error, loggingOut, logout } = useAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <img
            className="brand-logo"
            src="/assets/branding/gatewatch-icon.svg"
            alt=""
            aria-hidden="true"
          />
          <div>
            <div className="brand-name">GateWatch</div>
            <div className="brand-subtitle">API Gateway &amp; Monitoring</div>
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
          <UserAvatar key={user.avatarUrl ?? user.id} user={user} />
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

export function UserAvatar({ user }: { user: AuthenticatedUser }): ReactElement {
  const initials = user.githubUsername.trim().slice(0, 2).toUpperCase() || 'GW';
  const [failed, setFailed] = useState(false);

  return (
    <span className="avatar-badge" role="img" aria-label={`${user.githubUsername} profile picture`} title={user.githubUsername}>
      {user.avatarUrl && !failed ? (
        <img
          src={user.avatarUrl}
          alt=""
          onError={() => setFailed(true)}
          referrerPolicy="no-referrer"
        />
      ) : initials}
    </span>
  );
}
