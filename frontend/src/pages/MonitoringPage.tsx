import type { ReactElement } from 'react';

export function MonitoringPage(): ReactElement {
  return (
    <div className="page-container">
      <header className="page-header">
        <div>
          <p className="eyebrow">Monitoring</p>
          <h1>Observability</h1>
        </div>
      </header>
      <section className="panel">
        <h2>Upcoming monitoring work</h2>
        <p>
          This placeholder is reserved for the future monitoring dashboard, health checks, and alert
          timelines.
        </p>
      </section>
    </div>
  );
}
