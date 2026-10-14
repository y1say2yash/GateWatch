import type { ReactElement } from 'react';

export function APIsPage(): ReactElement {
  return (
    <div className="page-container">
      <header className="page-header">
        <div>
          <p className="eyebrow">APIs</p>
          <h1>Registered endpoints</h1>
        </div>
      </header>
      <section className="panel">
        <h2>Configuration placeholder</h2>
        <p>
          API management, routing, and authentication configuration will be added in a later milestone.
        </p>
      </section>
    </div>
  );
}
