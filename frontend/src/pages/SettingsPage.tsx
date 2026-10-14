import type { ReactElement } from 'react';

export function SettingsPage(): ReactElement {
  return (
    <div className="page-container">
      <header className="page-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Environment and access</h1>
        </div>
      </header>
      <section className="panel">
        <h2>Placeholder</h2>
        <p>
          Personal settings, gateway defaults, and admin controls will be implemented in a later milestone.
        </p>
      </section>
    </div>
  );
}
