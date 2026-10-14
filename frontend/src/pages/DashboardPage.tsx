import type { ReactElement } from 'react';

export function DashboardPage(): ReactElement {
  return (
    <div className="page-container">
      <header className="page-header">
        <div>
          <p className="eyebrow">Overview</p>
          <h1>Dashboard</h1>
        </div>
      </header>

      <section className="panel dashboard-empty" aria-labelledby="dashboard-empty-title">
        <div className="dashboard-empty-mark" aria-hidden="true">GW</div>
        <div>
          <h2 id="dashboard-empty-title">Your dashboard is ready</h2>
          <p>
            Live metrics, activity, and service health will appear here when the dashboard is
            connected to GateWatch backend data.
          </p>
        </div>
      </section>
    </div>
  );
}
