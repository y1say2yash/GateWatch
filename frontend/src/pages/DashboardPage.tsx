import { useEffect, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { MonitoringBarChart, type MonitoringBarDatum } from '../components/MonitoringCharts';
import { ApiError, apiRequest, apiRequestEnvelope } from '../lib/api';
import type { Api, HealthStatusResult, Project } from '../types/management';
import type { MonitoringSummary, RequestHistoryRecord } from '../types/monitoring';

interface ApiOverview {
  api: Api;
  project: Project;
  health: HealthStatusResult | null;
  healthUnavailable: boolean;
  summary: MonitoringSummary | null;
  recentRequests: RequestHistoryRecord[];
  requestsUnavailable: boolean;
}

interface DashboardData {
  projects: Project[];
  apis: ApiOverview[];
  partialFailures: number;
}

const getErrorMessage = (error: unknown): string =>
  error instanceof ApiError ? error.message : 'Unable to load dashboard data. Please try again.';

async function loadDashboardData(): Promise<DashboardData> {
  const projects = await apiRequest<Project[]>('/api/v1/projects');
  const projectResults = await Promise.allSettled(
    projects.map(async (project) => ({
      project,
      apis: await apiRequest<Api[]>(`/api/v1/projects/${project.id}/apis`),
    })),
  );
  const apiEntries = projectResults.flatMap((result) =>
    result.status === 'fulfilled'
      ? result.value.apis.map((api) => ({ api, project: result.value.project }))
      : [],
  );
  let partialFailures = projectResults.filter((result) => result.status === 'rejected').length;
  const from = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
  const to = new Date().toISOString();

  const apis = await Promise.all(apiEntries.map(async ({ api, project }) => {
    const params = new URLSearchParams({ from, to });
    const [healthResult, summaryResult, requestResult] = await Promise.allSettled([
      apiRequest<HealthStatusResult>(`/api/v1/apis/${api.id}/health/status`),
      apiRequest<MonitoringSummary>(`/api/v1/apis/${api.id}/monitoring/summary?${params.toString()}`),
      apiRequestEnvelope<RequestHistoryRecord[]>(
        `/api/v1/apis/${api.id}/requests?page=1&limit=20&sort=timestamp&order=desc`,
      ),
    ]);
    const failedCount = [healthResult, summaryResult, requestResult]
      .filter((result) => result.status === 'rejected').length;
    partialFailures += failedCount;
    return {
      api,
      project,
      health: healthResult.status === 'fulfilled' ? healthResult.value : null,
      healthUnavailable: healthResult.status === 'rejected',
      summary: summaryResult.status === 'fulfilled' ? summaryResult.value : null,
      recentRequests: requestResult.status === 'fulfilled' ? requestResult.value.data : [],
      requestsUnavailable: requestResult.status === 'rejected',
    };
  }));

  return { projects, apis, partialFailures };
}

function healthLabel(api: ApiOverview): string {
  if (api.healthUnavailable) return 'Unavailable';
  if (!api.health?.lastHealthCheckAt) return 'No checks yet';
  return api.health.healthStatus;
}

function healthClass(api: ApiOverview): string {
  if (api.healthUnavailable) return 'status-badge health-unavailable';
  return api.health?.lastHealthCheckAt
    ? `status-badge health-${api.health.healthStatus.toLowerCase()}`
    : 'status-badge lifecycle-unknown';
}


function responseClassCounts(apis: ApiOverview[]): MonitoringBarDatum[] {
  const classes: MonitoringBarDatum[] = [
    { label: '1xx informational', value: 0, color: '#64748b' },
    { label: '2xx successful', value: 0, color: '#059669' },
    { label: '3xx redirection', value: 0, color: '#2563eb' },
    { label: '4xx client errors', value: 0, color: '#d97706' },
    { label: '5xx server errors', value: 0, color: '#dc2626' },
    { label: 'Other / unknown', value: 0, color: '#7c3aed' },
  ];

  apis.forEach(({ summary }) => {
    if (!summary) return;

    Object.entries(summary.statusCodeCounts).forEach(([code, count]) => {
      if (!Number.isFinite(count) || count <= 0) return;

      const statusClass = Math.floor(Number(code) / 100);
      const index = statusClass >= 1 && statusClass <= 5 ? statusClass - 1 : 5;
      const bucket = classes[index];

      if (bucket) bucket.value += count;
    });
  });

  return classes.some((item) => item.value > 0) ? classes.filter((item) => item.value > 0) : [];
}


export function DashboardPage(): ReactElement {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;

    void Promise.resolve().then(async () => {
      if (!active) return;

      setLoading(true);
      setError(null);

      try {
        const result = await loadDashboardData();
        if (active) setData(result);
      } catch (loadError) {
        if (active) {
          setData(null);
          setError(getErrorMessage(loadError));
        }
      } finally {
        if (active) setLoading(false);
      }
    });

    return () => {
      active = false;
    };
  }, [reload]);

  const retry = (): void => setReload((version) => version + 1);

  // Render the response chart only when recorded status-code counts exist.
  const dashboardResponseClasses = data
    ? responseClassCounts(data.apis)
    : [];

  return (
    <div className="page-container">
      <header className="page-header">
        <div>
          <p className="eyebrow">Overview</p>
          <h1>Dashboard </h1>
          <p className="page-description">
            Your API gateway at a glance.
          </p>
        </div>
        <Link className="primary-button inline-link" to="/monitoring">
          Open monitoring
        </Link>
      </header>

      {loading && (
        <div className="panel state-panel" role="status">
          <span className="loader" />
          Loading dashboard data…
        </div>
      )}

      {!loading && error && (
        <div className="panel state-panel" role="alert">
          <p>{error}</p>
          <button
            className="secondary-button"
            type="button"
            onClick={retry}
          >
            Retry
          </button>
        </div>
      )}

      {!loading && data && data.projects.length === 0 && (
        <section
          className="panel dashboard-empty"
          aria-labelledby="dashboard-empty-title"
        >
          <img
            className="dashboard-empty-logo"
            src="/assets/branding/gatewatch-icon.svg"
            alt=""
            aria-hidden="true"
          />
          <div>
            <p className="eyebrow">Get started</p>
            <h2 id="dashboard-empty-title">
              Your APIs deserve a watch.
            </h2>
            <p>Add your API to see it here. Create a project.</p>
            <Link
              className="primary-button inline-link"
              to="/projects?create=1"
            >
              Create a project
            </Link>
          </div>
        </section>
      )}

      {!loading &&
        data &&
        data.projects.length > 0 &&
        data.apis.length === 0 &&
        data.partialFailures > 0 && (
          <div className="panel state-panel" role="alert">
            <p>
              Projects loaded, but API inventory could not be retrieved.
              Retry to load the workspace.
            </p>
            <button
              className="secondary-button"
              type="button"
              onClick={retry}
            >
              Retry
            </button>
          </div>
        )}

      {!loading &&
        data &&
        data.projects.length > 0 &&
        data.apis.length === 0 &&
        data.partialFailures === 0 && (
          <section
            className="panel dashboard-empty"
            aria-labelledby="dashboard-empty-title"
          >
            <div>
              <p className="eyebrow">
                {data.projects.length}{' '}
                {data.projects.length === 1 ? 'project' : 'projects'}
              </p>
              <h2 id="dashboard-empty-title">
                Your workspace is ready for an API.
              </h2>
              <p>
                Register an API inside a project to begin routing and
                monitoring real traffic.
              </p>
              <Link
                className="primary-button inline-link"
                to={`/projects/${data.projects[0]?.id}/apis`}
              >
                Open a project
              </Link>
            </div>
          </section>
        )}

      {!loading && data && data.apis.length > 0 && (
        <>
          <section
            className="panel dashboard-quick-actions"
            aria-labelledby="dashboard-quick-actions-title"
          >
            <div>
              <p className="eyebrow">Shortcuts</p>
              <h2 id="dashboard-quick-actions-title">Quick actions</h2>
            </div>
            <div className="dashboard-quick-action-links">
              <Link
                className="primary-button inline-link"
                to={`/projects/${data.projects[0]?.id}/apis/new`}
              >
                Register API
              </Link>
              <Link
                className="secondary-button inline-link"
                to="/monitoring"
              >
                Open monitoring
              </Link>
              <Link
                className="secondary-button inline-link"
                to="/testing"
              >
                Manage tests
              </Link>
              <Link
                className="secondary-button inline-link"
                to="/alerts"
              >
                View alerts
              </Link>
            </div>
          </section>

          {data.partialFailures > 0 && (
            <p className="dashboard-partial-warning" role="status">
              Some API data could not be loaded. Available results are
              shown; retry from Monitoring for current details.
            </p>
          )}

          <br />
          <section
            className="metric-grid dashboard-metrics"
            aria-label="Last 24 hours"
          >
            <article className="metric-card">
              <p className="metric-label">Registered APIs</p>
              <p className="metric-value">{data.apis.length}</p>
              <p className="metric-trend">
                {data.projects.length}{' '}
                {data.projects.length === 1 ? 'project' : 'projects'}
              </p>
            </article>

            <article className="metric-card">
              <p className="metric-label">Active APIs</p>
              <p className="metric-value">
                {
                  data.apis.filter(
                    ({ api }) => api.status === 'ACTIVE',
                  ).length
                }
              </p>
              <p className="metric-trend">Lifecycle state: Active</p>
            </article>

            <article className="metric-card">
              <p className="metric-label">
                Requests · last 24 hours ·{' '}
                {data.apis.filter(({ summary }) => summary).length}/
                {data.apis.length} APIs
              </p>
              <p className="metric-value">
                {data.apis.some(({ summary }) => summary)
                  ? data.apis
                    .reduce(
                      (total, item) =>
                        total + (item.summary?.totalRequests ?? 0),
                      0,
                    )
                    .toLocaleString()
                  : 'Unavailable'}
              </p>
              <p className="metric-trend">Persisted gateway requests</p>
            </article>

            <article className="metric-card">
              <p className="metric-label">
                HTTP errors · last 24 hours ·{' '}
                {data.apis.filter(({ summary }) => summary).length}/
                {data.apis.length} APIs
              </p>
              <p className="metric-value">
                {data.apis.some(({ summary }) => summary)
                  ? data.apis
                    .reduce(
                      (total, item) =>
                        total + (item.summary?.errorCount ?? 0),
                      0,
                    )
                    .toLocaleString()
                  : 'Unavailable'}
              </p>
              <p className="metric-trend">
                Status codes 400 and above
              </p>
            </article>

            <article className="metric-card">
              <p className="metric-label">API health checks</p>
              <p className="metric-value">
                {
                  data.apis.filter(
                    ({ health }) => health?.lastHealthCheckAt,
                  ).length
                }
                /{data.apis.length}
              </p>
              <p className="metric-trend">
                APIs with a recorded check
              </p>
            </article>
          </section>

          {dashboardResponseClasses.length > 0 && (
            <div className="monitoring-chart-grid dashboard-chart-grid">
              <MonitoringBarChart
                title="HTTP response classes · last 24 hours"
                description={`Recorded status-code counts from the 24-hour summaries for ${data.apis.filter(({ summary }) => summary).length
                  } of ${data.apis.length} APIs.`}
                axisLabel="Responses"
                items={dashboardResponseClasses}
              />
            </div>
          )}

          <div className="content-grid dashboard-content-grid">
            <section className="panel dashboard-section">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Workspace</p>
                  <h2>API health</h2>
                </div>
                <Link className="text-link" to="/monitoring">
                  View monitoring
                </Link>
              </div>

              <ul className="dashboard-api-list">
                {data.apis.map((item) => (
                  <li key={item.api.id}>
                    <div className="dashboard-api-name">
                      <Link
                        className="text-link"
                        to={`/apis/${item.api.id}`}
                      >
                        {item.api.name}
                      </Link>
                      <span>
                        {item.project.name} · Lifecycle: {item.api.status}
                      </span>
                      <span>
                        Latest recorded latency:{' '}
                        {item.healthUnavailable
                          ? 'Unavailable'
                          : item.health?.latestCheck?.responseTimeMs ===
                            null ||
                            item.health?.latestCheck?.responseTimeMs ===
                            undefined
                            ? 'Not recorded'
                            : `${item.health.latestCheck.responseTimeMs} ms`}
                        {item.health?.lastHealthCheckAt
                          ? ` · Checked ${new Date(
                            item.health.lastHealthCheckAt,
                          ).toLocaleString()}`
                          : ''}
                      </span>
                    </div>
                    <span className={healthClass(item)}>
                      {healthLabel(item)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="panel dashboard-section">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Traffic</p>
                  <h2>Recent requests</h2>
                </div>
                <Link className="text-link" to="/monitoring">
                  View history
                </Link>
              </div>

              {data.apis.every(
                ({ recentRequests }) => recentRequests.length === 0,
              ) ? (
                <p className="dashboard-empty-activity">
                  {data.apis.some(({ requestsUnavailable }) => requestsUnavailable)
                    ? 'Request history is currently unavailable for one or more APIs.'
                    : 'No persisted requests are available for these APIs yet.'}
                </p>
              ) : (
                <ul className="dashboard-request-list">
                  {data.apis
                    .flatMap((item) =>
                      item.recentRequests.map((request) => ({
                        ...request,
                        apiName: item.api.name,
                      })),
                    )
                    .sort(
                      (a, b) =>
                        new Date(b.timestamp).getTime() -
                        new Date(a.timestamp).getTime(),
                    )
                    .slice(0, 5)
                    .map((request) => (
                      <li key={request.requestId}>
                        <div>
                          <strong>
                            {request.method}{' '}
                            <code>{request.path}</code>
                          </strong>
                          <span>{request.apiName}</span>
                        </div>
                        <div className="dashboard-request-meta">
                          <span
                            className={`request-status ${request.statusCode >= 500
                              ? 'request-status-error'
                              : request.statusCode >= 400
                                ? 'request-status-warning'
                                : 'request-status-ok'
                              }`}
                          >
                            {request.statusCode}
                          </span>
                          <time dateTime={request.timestamp}>
                            {new Date(request.timestamp).toLocaleString()}
                          </time>
                        </div>
                      </li>
                    ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
