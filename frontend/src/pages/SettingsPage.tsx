import type { ReactElement } from 'react';

import { UserAvatar } from '../components/layout/AppShell';
import { useAuth } from '../features/auth/auth-context';

export function SettingsPage(): ReactElement {
  const { user, loggingOut, logout } = useAuth();

  if (!user) {
    return <div className="panel state-panel" role="status">Loading account details…</div>;
  }

  return (
    <div className="page-container">
      <header className="page-header">
        <div>
          <p className="eyebrow">Account</p>
          <h1>Settings</h1>
          <p className="page-description">Your GateWatch account and sign-in details.</p>
        </div>
      </header>

      <div className="settings-grid">
        <section className="panel settings-profile" aria-labelledby="settings-profile-title">
          <div className="settings-profile-heading">
            <UserAvatar key={user.avatarUrl ?? user.id} user={user} />
            <div>
              <p className="eyebrow">Profile</p>
              <h2 id="settings-profile-title">{user.githubUsername}</h2>
              <p>GitHub account</p>
            </div>
          </div>
          <dl className="settings-details">
            <div><dt>GitHub username</dt><dd>@{user.githubUsername}</dd></div>
            {user.email && <div><dt>Email</dt><dd>{user.email}</dd></div>}
            <div><dt>Role</dt><dd>{user.isAdmin ? 'Administrator' : 'Member'}</dd></div>
            <div><dt>Account status</dt><dd><span className={`status-badge ${user.status === 'ACTIVE' ? 'lifecycle-active' : 'lifecycle-disabled'}`}>{user.status.replaceAll('_', ' ')}</span></dd></div>
          </dl>
        </section>

        <section className="panel settings-section" aria-labelledby="settings-security-title">
          <p className="eyebrow">Authentication</p>
          <h2 id="settings-security-title">Sign-in and security</h2>
          <dl className="settings-details">
            <div><dt>Sign-in provider</dt><dd>GitHub</dd></div>
            <div><dt>Session</dt><dd>Authenticated with your GateWatch account</dd></div>
          </dl>
          <p className="settings-note">
            Registered API client keys are separate from your GateWatch sign-in. They are managed on each API’s details page; secret values are never shown here.
          </p>
          <button className="secondary-button" type="button" onClick={() => void logout()} disabled={loggingOut}>
            {loggingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </section>

        <section className="panel settings-section" aria-labelledby="settings-preferences-title">
          <p className="eyebrow">Preferences</p>
          <h2 id="settings-preferences-title">No additional account settings</h2>
          <p>
            GateWatch does not currently provide persisted personal preferences. Monitoring ranges and API filters are selected on the Monitoring page.
          </p>
        </section>

        <section className="panel settings-section" aria-labelledby="settings-about-title">
          <p className="eyebrow">About</p>
          <h2 id="settings-about-title">GateWatch</h2>
          <p>API gateway and monitoring for the services you manage.</p>
          <a className="text-link" href="https://github.com/y1say2yash/GateWatch" target="_blank" rel="noreferrer">
            GateWatch project and documentation
          </a>
        </section>
      </div>
    </div>
  );
}
