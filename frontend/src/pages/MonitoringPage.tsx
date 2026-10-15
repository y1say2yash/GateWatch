import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { ApiError, apiRequest, apiRequestEnvelope } from '../lib/api';
import type { Api, ApiRoute, HealthStatus, Project } from '../types/management';
import type {
  ApiHealthConfiguration,
  ApiHealthHistoryEntry,
  ApiHealthOverviewEntry,
  ApiHealthStatus,
  GatewayRoute,
  MonitoringSummary,
  RequestHistoryRecord,
} from '../types/monitoring';

const monitoringTabs = ['Gateway', 'Requests', 'API health', 'Health history', 'Metrics', 'Operations'] as const;
type MonitoringTab = typeof monitoringTabs[number];

interface ApiInventoryEntry {
  api: Api;
  project: Project;
}

interface Inventory {
  projects: Project[];
  apis: ApiInventoryEntry[];
  routes: GatewayRoute[];
}

interface RequestQuery {
  page: number;
  method: string;
  statusCode: string;
  from: string;
  to: string;
  order: 'asc' | 'desc';
}

interface MetricRange {
  from: string;
  to: string;
}

const localDateTimeValue = (date: Date): string => {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
};

const initialMetricRange = (): MetricRange => {
  const to = new Date();
  return {
    from: localDateTimeValue(new Date(to.getTime() - 24 * 60 * 60 * 1_000)),
    to: localDateTimeValue(to),
  };
};

const toIsoTimestamp = (value: string): string | undefined => {
  if (!value) return undefined;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : undefined;
};

const apiLabel = (entry: ApiInventoryEntry): string => `${entry.project.name} / ${entry.api.name}`;

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof ApiError ? error.message : fallback;

async function loadInventory(): Promise<Inventory> {
  const projects = await apiRequest<Project[]>('/api/v1/projects');
  const projectApiLists = await Promise.all(
    projects.map(async (project) => ({
      project,
      apis: await apiRequest<Api[]>(`/api/v1/projects/${project.id}/apis`),
    })),
  );
  const apis = projectApiLists.flatMap(({ project, apis }) =>
    apis.map((api) => ({ api, project })),
  );
  const routeLists = await Promise.all(
    apis.map(async ({ api, project }) => ({
      api,
      project,
      routes: await apiRequest<ApiRoute[]>(`/api/v1/apis/${api.id}/routes`),
    })),
  );
  const routes = routeLists.flatMap(({ api, project, routes }) =>
    routes.map((route) => ({ api, project, route })),
  );
  return { projects, apis, routes };
}

function formatDate(value: string | null): string {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Timestamp unavailable';
}

function healthClass(status: HealthStatus): string {
  return `status-badge health-${status.toLowerCase()}`;
}

function requestStatusClass(statusCode: number): string {
  if (statusCode >= 500) return 'request-status request-status-error';
  if (statusCode >= 400) return 'request-status request-status-warning';
  return 'request-status request-status-ok';
}

export function MonitoringPage(): ReactElement {
  const [activeTab, setActiveTab] = useState<MonitoringTab>('Gateway');
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [loadingInventory, setLoadingInventory] = useState(true);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [inventoryReload, setInventoryReload] = useState(0);
  const [selectedApiId, setSelectedApiId] = useState('');
  const [requestQuery, setRequestQuery] = useState<RequestQuery>({
    page: 1,
    method: '',
    statusCode: '',
    from: '',
    to: '',
    order: 'desc',
  });
  const [requestMethod, setRequestMethod] = useState('');
  const [requestStatus, setRequestStatus] = useState('');
  const [requestFrom, setRequestFrom] = useState('');
  const [requestTo, setRequestTo] = useState('');
  const [requestOrder, setRequestOrder] = useState<'asc' | 'desc'>('desc');
  const [requestFilterError, setRequestFilterError] = useState<string | null>(null);
  const [requestRows, setRequestRows] = useState<RequestHistoryRecord[]>([]);
  const [requestPageInfo, setRequestPageInfo] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestReload, setRequestReload] = useState(0);
  const [healthRows, setHealthRows] = useState<ApiHealthOverviewEntry[]>([]);
  const [loadingHealth, setLoadingHealth] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [healthReload, setHealthReload] = useState(0);
  const [healthHistory, setHealthHistory] = useState<ApiHealthHistoryEntry[]>([]);
  const [loadingHealthHistory, setLoadingHealthHistory] = useState(false);
  const [healthHistoryError, setHealthHistoryError] = useState<string | null>(null);
  const [healthHistoryReload, setHealthHistoryReload] = useState(0);
  const [metricInputs, setMetricInputs] = useState<MetricRange>(initialMetricRange);
  const [metricRange, setMetricRange] = useState<MetricRange>(initialMetricRange);
  const [metricRangeError, setMetricRangeError] = useState<string | null>(null);
  const [summary, setSummary] = useState<MonitoringSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryReload, setSummaryReload] = useState(0);
  const inventorySequence = useRef(0);
  const selectedApi = inventory?.apis.find(({ api }) => api.id === selectedApiId)?.api
    ?? inventory?.apis[0]?.api;
  const effectiveApiId = selectedApi?.id ?? '';

  useEffect(() => {
    let active = true;
    const requestId = ++inventorySequence.current;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setLoadingInventory(true);
      setInventoryError(null);
      try {
        const loadedInventory = await loadInventory();
        if (active && requestId === inventorySequence.current) setInventory(loadedInventory);
      } catch (error) {
        if (active && requestId === inventorySequence.current) {
          setInventory(null);
          setInventoryError(getErrorMessage(error, 'Unable to load gateway routes. Please try again.'));
        }
      } finally {
        if (active && requestId === inventorySequence.current) setLoadingInventory(false);
      }
    });
    return () => {
      active = false;
      inventorySequence.current += 1;
    };
  }, [inventoryReload]);

  useEffect(() => {
    if (activeTab !== 'Requests' || !effectiveApiId) return;
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setLoadingRequests(true);
      setRequestError(null);
      const params = new URLSearchParams({
        page: String(requestQuery.page),
        limit: '20',
        sort: 'timestamp',
        order: requestQuery.order,
      });
      if (requestQuery.method) params.set('method', requestQuery.method);
      if (requestQuery.statusCode) params.set('statusCode', requestQuery.statusCode);
      if (requestQuery.from) params.set('from', requestQuery.from);
      if (requestQuery.to) params.set('to', requestQuery.to);
      try {
        const page = await apiRequestEnvelope<RequestHistoryRecord[]>(
          `/api/v1/apis/${effectiveApiId}/requests?${params.toString()}`,
        );
        if (!page.pagination) {
          throw new ApiError('The server returned an invalid response.', null);
        }
        if (active) {
          setRequestRows(page.data);
          setRequestPageInfo(page.pagination);
        }
      } catch (error) {
        if (active) {
          setRequestRows([]);
          setRequestPageInfo({ page: requestQuery.page, limit: 20, total: 0, totalPages: 0 });
          setRequestError(getErrorMessage(error, 'Unable to load request history. Please try again.'));
        }
      } finally {
        if (active) setLoadingRequests(false);
      }
    });
    return () => { active = false; };
  }, [activeTab, effectiveApiId, requestQuery, requestReload]);

  useEffect(() => {
    if (activeTab !== 'API health' || !inventory?.apis.length) return;
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setLoadingHealth(true);
      setHealthError(null);
      try {
        const rows = await Promise.all(inventory.apis.map(async ({ api, project }) => {
          const [status, configuration] = await Promise.all([
            apiRequest<ApiHealthStatus>(`/api/v1/apis/${api.id}/health/status`),
            apiRequest<ApiHealthConfiguration>(`/api/v1/apis/${api.id}/health`),
          ]);
          return { api, project, status, configuration };
        }));
        if (active) setHealthRows(rows);
      } catch (error) {
        if (active) {
          setHealthRows([]);
          setHealthError(getErrorMessage(error, 'Unable to load API health. Please try again.'));
        }
      } finally {
        if (active) setLoadingHealth(false);
      }
    });
    return () => { active = false; };
  }, [activeTab, inventory, healthReload]);

  useEffect(() => {
    if (activeTab !== 'Health history' || !effectiveApiId) return;
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setLoadingHealthHistory(true);
      setHealthHistoryError(null);
      try {
        const rows = await apiRequest<ApiHealthHistoryEntry[]>(
          `/api/v1/apis/${effectiveApiId}/health/history?limit=100`,
        );
        if (active) setHealthHistory(rows);
      } catch (error) {
        if (active) {
          setHealthHistory([]);
          setHealthHistoryError(getErrorMessage(error, 'Unable to load health-check history. Please try again.'));
        }
      } finally {
        if (active) setLoadingHealthHistory(false);
      }
    });
    return () => { active = false; };
  }, [activeTab, effectiveApiId, healthHistoryReload]);

  useEffect(() => {
    if (activeTab !== 'Metrics' || !effectiveApiId) return;
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setLoadingSummary(true);
      setSummaryError(null);
      const from = toIsoTimestamp(metricRange.from);
      const to = toIsoTimestamp(metricRange.to);
      if (!from || !to || from > to) {
        setSummary(null);
        setSummaryError('Choose a valid time range where the start is not later than the end.');
        setLoadingSummary(false);
        return;
      }
      const params = new URLSearchParams({ from, to });
      try {
        const result = await apiRequest<MonitoringSummary>(
          `/api/v1/apis/${effectiveApiId}/monitoring/summary?${params.toString()}`,
        );
        if (active) setSummary(result);
      } catch (error) {
        if (active) {
          setSummary(null);
          setSummaryError(getErrorMessage(error, 'Unable to load monitoring metrics. Please try again.'));
        }
      } finally {
        if (active) setLoadingSummary(false);
      }
    });
    return () => { active = false; };
  }, [activeTab, effectiveApiId, metricRange, summaryReload]);

  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const currentIndex = monitoringTabs.indexOf(activeTab);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % monitoringTabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + monitoringTabs.length) % monitoringTabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = monitoringTabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = monitoringTabs[nextIndex];
    if (!nextTab) return;
    setActiveTab(nextTab);
    document.getElementById(`monitoring-tab-${nextTab.toLowerCase().replaceAll(' ', '-')}`)?.focus();
  };

  const submitRequestFilters = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const statusCode = requestStatus.trim();
    if (statusCode && (!/^\d{3}$/.test(statusCode) || Number(statusCode) < 100 || Number(statusCode) > 599)) {
      setRequestFilterError('Enter an HTTP status code from 100 to 599.');
      return;
    }
    const from = toIsoTimestamp(requestFrom);
    const to = toIsoTimestamp(requestTo);
    if ((requestFrom && !from) || (requestTo && !to) || (from && to && from > to)) {
      setRequestFilterError('Choose a valid time range where the start is not later than the end.');
      return;
    }
    setRequestFilterError(null);
    setRequestQuery({
      page: 1,
      method: requestMethod,
      statusCode,
      from: from ?? '',
      to: to ?? '',
      order: requestOrder,
    });
  };

  const submitMetricRange = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const from = toIsoTimestamp(metricInputs.from);
    const to = toIsoTimestamp(metricInputs.to);
    if (!from || !to || from > to) {
      setMetricRangeError('Choose a valid time range where the start is not later than the end.');
      return;
    }
    setMetricRangeError(null);
    setMetricRange(metricInputs);
  };

  const retryInventory = useCallback(() => setInventoryReload((version) => version + 1), []);
  const requestRouteById = new Map((inventory?.routes ?? []).map(({ route, api, project }) => [
    route.id,
    `${project.name} / ${api.name} (${route.method} ${route.pathPrefix})`,
  ] as const));
  const currentHealth: ApiHealthOverviewEntry | undefined = healthRows.find(({ api }) => api.id === effectiveApiId);

  if (loadingInventory) {
    return <div className="page-container"><div className="panel state-panel" role="status"><span className="loader" />Loading gateway inventory…</div></div>;
  }
  if (inventoryError || !inventory) {
    return (
      <div className="page-container">
        <header className="page-header"><div><p className="eyebrow">Operations</p><h1>Monitoring</h1></div></header>
        <div className="panel state-panel" role="alert"><p>{inventoryError ?? 'Gateway inventory is unavailable.'}</p><button className="secondary-button" type="button" onClick={retryInventory}>Retry</button></div>
      </div>
    );
  }

  const renderInventoryEmpty = (view: 'gateway' | 'api' = 'api'): ReactElement => (
    <div className="panel empty-panel">
      <h2>{view === 'gateway' && inventory.apis.length ? 'No gateway routes configured' : inventory.projects.length ? 'No APIs configured' : 'No projects yet'}</h2>
      <p>{view === 'gateway' && inventory.apis.length ? 'Create an API route in a project to expose it through the gateway.' : inventory.projects.length ? 'Create an API and gateway route in a project to see operational data here.' : 'Create a project and register an API to start monitoring gateway traffic.'}</p>
      <Link className="primary-button inline-link" to="/projects">Browse projects</Link>
    </div>
  );

  return (
    <div className="page-container">
      <header className="page-header">
        <div><p className="eyebrow">Operations</p><h1>Monitoring</h1></div>
        <button className="secondary-button" type="button" onClick={retryInventory}>Refresh routes</button>
      </header>

      <div className="monitoring-tab-list" role="tablist" aria-label="Monitoring views" onKeyDown={handleTabKeyDown}>
        {monitoringTabs.map((tab) => (
          <button
            className="monitoring-tab"
            id={`monitoring-tab-${tab.toLowerCase().replaceAll(' ', '-')}`}
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls="monitoring-tab-panel"
            tabIndex={activeTab === tab ? 0 : -1}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      <section className="monitoring-tab-panel" role="tabpanel" tabIndex={0} id="monitoring-tab-panel" aria-labelledby={`monitoring-tab-${activeTab.toLowerCase().replaceAll(' ', '-')}`}>
        {activeTab === 'Gateway' && (
          <>
            <section className="panel monitoring-intro">
              <h2>Gateway routes</h2>
              <p>Routes are discovered from your projects, APIs, and route configuration. The public host depends on your deployment; paths below follow the gateway route format.</p>
              <p className="monitoring-footnote">Configured upstream URLs and credentials are not shown here.</p>
            </section>
            {inventory.routes.length === 0 ? renderInventoryEmpty('gateway') : (
              <div className="panel table-scroll">
                <table className="monitoring-table">
                  <caption className="visually-hidden">Configured gateway routes</caption>
                  <thead><tr><th>Project</th><th>API</th><th>Gateway path</th><th>Method</th><th>Route</th><th>API lifecycle</th><th>Gateway key auth</th></tr></thead>
                  <tbody>
                    {inventory.routes.map(({ project, api, route }) => (
                      <tr key={route.id}>
                        <td>{project.name}</td>
                        <td><Link className="text-link" to={`/apis/${api.id}`}>{api.name}</Link></td>
                        <td><code>/p/{project.slug}{route.pathPrefix === '/' ? '' : route.pathPrefix}</code></td>
                        <td>{route.method}</td>
                        <td>{route.isActive ? 'Enabled' : 'Disabled'}</td>
                        <td><span className={`status-badge lifecycle-${api.status.toLowerCase()}`}>{api.status}</span></td>
                        <td>{api.authRequired ? 'Required' : 'Not required'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {activeTab === 'Requests' && (
          <>
            {inventory.apis.length === 0 ? renderInventoryEmpty() : (
              <>
                <section className="panel monitoring-intro"><h2>Gateway request history</h2><p>History is fetched from the selected API with server-side filters and pagination. Only persisted, API-linked requests are represented; unmatched gateway paths may not have a history record. Request and response bodies are not available here.</p></section>
                <label className="monitoring-api-select" htmlFor="request-api">API</label>
                <select
                  id="request-api"
                  value={effectiveApiId}
                  onChange={(event) => {
                    setSelectedApiId(event.target.value);
                    setRequestQuery((query) => ({ ...query, page: 1 }));
                  }}
                >
                  {inventory.apis.map((entry) => <option key={entry.api.id} value={entry.api.id}>{apiLabel(entry)}</option>)}
                </select>
                <form className="panel monitoring-filter-form" onSubmit={submitRequestFilters}>
                  <div className="monitoring-filter-field">
                    <label htmlFor="request-method">Method</label>
                    <select id="request-method" value={requestMethod} onChange={(event) => setRequestMethod(event.target.value)}>
                      <option value="">All methods</option>
                      {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((method) => <option key={method} value={method}>{method}</option>)}
                    </select>
                  </div>
                  <div className="monitoring-filter-field">
                    <label htmlFor="request-status">Exact HTTP status</label>
                    <input id="request-status" inputMode="numeric" value={requestStatus} onChange={(event) => setRequestStatus(event.target.value)} placeholder="Any" />
                  </div>
                  <div className="monitoring-filter-field">
                    <label htmlFor="request-from">From</label>
                    <input id="request-from" type="datetime-local" value={requestFrom} onChange={(event) => setRequestFrom(event.target.value)} />
                  </div>
                  <div className="monitoring-filter-field">
                    <label htmlFor="request-to">To</label>
                    <input id="request-to" type="datetime-local" value={requestTo} onChange={(event) => setRequestTo(event.target.value)} />
                  </div>
                  <div className="monitoring-filter-field">
                    <label htmlFor="request-order">Timestamp order</label>
                    <select id="request-order" value={requestOrder} onChange={(event) => setRequestOrder(event.target.value as 'asc' | 'desc')}>
                      <option value="desc">Newest first</option><option value="asc">Oldest first</option>
                    </select>
                  </div>
                  <button className="primary-button" type="submit">Apply filters</button>
                  {requestFilterError && <p className="auth-error" role="alert">{requestFilterError}</p>}
                </form>
                {loadingRequests ? <div className="panel state-panel" role="status"><span className="loader" />Loading request history…</div>
                  : requestError ? <div className="panel state-panel" role="alert"><p>{requestError}</p><button className="secondary-button" type="button" onClick={() => setRequestReload((version) => version + 1)}>Retry</button></div>
                    : requestRows.length === 0 ? <div className="panel empty-panel"><h2>No matching requests</h2><p>No recorded gateway requests match this API and filter set.</p></div>
                      : (
                        <div className="panel table-scroll">
                          <table className="monitoring-table">
                            <caption className="visually-hidden">Gateway request history for {selectedApi?.name}</caption>
                            <thead><tr><th>Timestamp</th><th>Route</th><th>Method</th><th>Request path</th><th>Status</th><th>Latency</th><th>Outcome</th></tr></thead>
                            <tbody>{requestRows.map((row) => (
                              <tr key={row.requestId}>
                                <td><time dateTime={row.timestamp}>{formatDate(row.timestamp)}</time></td>
                                <td>{row.routeId ? requestRouteById.get(row.routeId) ?? 'Route unavailable' : 'Not recorded'}</td>
                                <td>{row.method}</td><td><code>{row.path}</code></td>
                                <td><span className={requestStatusClass(row.statusCode)}>{row.statusCode}</span></td>
                                <td>{row.latencyMs === null ? 'Not recorded' : `${row.latencyMs} ms`}</td>
                                <td>{row.result?.errorCode ? `Gateway error: ${row.result.errorCode}` : row.result?.source === 'upstream' ? 'Upstream response' : row.result?.source === 'gateway' ? 'Gateway response' : 'Not recorded'}</td>
                              </tr>
                            ))}</tbody>
                          </table>
                          <nav className="monitoring-pagination" aria-label="Request history pagination">
                            <span>Page {requestPageInfo.page} of {Math.max(1, requestPageInfo.totalPages)} · {requestPageInfo.total} matching requests</span>
                            <div>
                              <button className="secondary-button" type="button" disabled={requestPageInfo.page <= 1} onClick={() => setRequestQuery((query) => ({ ...query, page: query.page - 1 }))}>Previous</button>
                              <button className="secondary-button" type="button" disabled={requestPageInfo.page >= requestPageInfo.totalPages} onClick={() => setRequestQuery((query) => ({ ...query, page: query.page + 1 }))}>Next</button>
                            </div>
                          </nav>
                        </div>
                      )}
              </>
            )}
          </>
        )}

        {activeTab === 'API health' && (
          <>
            <section className="panel monitoring-intro"><h2>API health</h2><p>Health status is the backend’s most recently stored check result. API lifecycle is shown separately; disabled or unchecked APIs are never described as healthy based on lifecycle alone.</p></section>
            {loadingHealth ? <div className="panel state-panel" role="status"><span className="loader" />Loading API health…</div>
              : healthError ? <div className="panel state-panel" role="alert"><p>{healthError}</p><button className="secondary-button" type="button" onClick={() => setHealthReload((version) => version + 1)}>Retry</button></div>
                : inventory.apis.length === 0 ? renderInventoryEmpty()
                  : (
                    <div className="panel table-scroll">
                      <table className="monitoring-table">
                        <caption className="visually-hidden">Health status and lifecycle for each API</caption>
                        <thead><tr><th>Project / API</th><th>Health</th><th>Lifecycle</th><th>Check configuration</th><th>Last check</th><th>Response</th><th>Last result</th></tr></thead>
                        <tbody>{healthRows.map(({ api, project, status, configuration }) => {
                          const check = status.latestCheck;
                          return (
                            <tr key={api.id}>
                              <td><Link className="text-link" to={`/apis/${api.id}`}>{project.name} / {api.name}</Link></td>
                              <td>{!status.lastHealthCheckAt ? <span className="status-badge lifecycle-unknown">No checks yet</span> : <span className={healthClass(status.healthStatus)}>{status.healthStatus}</span>}</td>
                              <td><span className={`status-badge lifecycle-${api.status.toLowerCase()}`}>{api.status}</span></td>
                              <td>{configuration.enabled ? `Enabled · every ${configuration.intervalSeconds}s` : 'Disabled'}</td>
                              <td>{formatDate(status.lastHealthCheckAt)}</td>
                              <td>{check?.responseTimeMs === null || check?.responseTimeMs === undefined ? 'Not recorded' : `${check.responseTimeMs} ms`}</td>
                              <td>{check?.httpStatus ? `HTTP ${check.httpStatus}` : check?.errorMessage ?? 'No check result'}</td>
                            </tr>
                          );
                        })}</tbody>
                      </table>
                    </div>
                  )}
            {currentHealth?.status.latestCheck?.errorMessage && <p className="monitoring-footnote">Selected API last check: {currentHealth.status.latestCheck.errorMessage}</p>}
          </>
        )}

        {activeTab === 'Health history' && (
          <>
            <section className="panel monitoring-intro"><h2>Health-check history</h2><p>Results are ordered newest first by the backend. The endpoint returns at most 100 records; this view does not imply a complete lifetime history.</p></section>
            {inventory.apis.length === 0 ? renderInventoryEmpty() : (
              <>
                <label className="monitoring-api-select" htmlFor="health-history-api">API</label>
                <select id="health-history-api" value={effectiveApiId} onChange={(event) => setSelectedApiId(event.target.value)}>
                  {inventory.apis.map((entry) => <option key={entry.api.id} value={entry.api.id}>{apiLabel(entry)}</option>)}
                </select>
                {loadingHealthHistory ? <div className="panel state-panel" role="status"><span className="loader" />Loading health-check history…</div>
                  : healthHistoryError ? <div className="panel state-panel" role="alert"><p>{healthHistoryError}</p><button className="secondary-button" type="button" onClick={() => setHealthHistoryReload((version) => version + 1)}>Retry</button></div>
                    : healthHistory.length === 0 ? <div className="panel empty-panel"><h2>No health checks recorded</h2><p>This API has no persisted health-check results yet.</p></div>
                      : (
                        <div className="panel table-scroll">
                          <table className="monitoring-table">
                            <caption className="visually-hidden">Health-check history for {selectedApi?.name}</caption>
                            <thead><tr><th>Checked at</th><th>Result</th><th>Response time</th><th>HTTP status</th><th>Attempts</th><th>Trigger</th><th>Summary</th></tr></thead>
                            <tbody>{healthHistory.map((record) => (
                              <tr key={record.id}>
                                <td><time dateTime={record.checkedAt}>{formatDate(record.checkedAt)}</time></td>
                                <td><span className={healthClass(record.status)}>{record.status}</span></td>
                                <td>{record.responseTimeMs === null ? 'Not recorded' : `${record.responseTimeMs} ms`}</td>
                                <td>{record.httpStatus ?? 'Not recorded'}</td><td>{record.attemptCount}</td><td>{record.isManual ? 'Manual' : 'Scheduled'}</td>
                                <td>{record.errorMessage ?? 'No error reported'}</td>
                              </tr>
                            ))}</tbody>
                          </table>
                        </div>
                      )}
              </>
            )}
          </>
        )}

        {activeTab === 'Metrics' && (
          <>
            <section className="panel monitoring-intro"><h2>Request metrics</h2><p>Metrics are backend aggregates for one selected API and an inclusive time range; they are not extrapolated from the visible request-history page.</p></section>
            {inventory.apis.length === 0 ? renderInventoryEmpty() : (
              <>
                <label className="monitoring-api-select" htmlFor="metrics-api">API</label>
                <select id="metrics-api" value={effectiveApiId} onChange={(event) => setSelectedApiId(event.target.value)}>
                  {inventory.apis.map((entry) => <option key={entry.api.id} value={entry.api.id}>{apiLabel(entry)}</option>)}
                </select>
                <form className="panel monitoring-filter-form metric-range-form" onSubmit={submitMetricRange}>
                  <div className="monitoring-filter-field">
                    <label htmlFor="metrics-from">From</label>
                    <input id="metrics-from" type="datetime-local" value={metricInputs.from} onChange={(event) => setMetricInputs((range) => ({ ...range, from: event.target.value }))} />
                  </div>
                  <div className="monitoring-filter-field">
                    <label htmlFor="metrics-to">To</label>
                    <input id="metrics-to" type="datetime-local" value={metricInputs.to} onChange={(event) => setMetricInputs((range) => ({ ...range, to: event.target.value }))} />
                  </div>
                  <button className="primary-button" type="submit">Apply range</button>
                  {metricRangeError && <p className="auth-error" role="alert">{metricRangeError}</p>}
                </form>
                {loadingSummary ? <div className="panel state-panel" role="status"><span className="loader" />Loading metrics…</div>
                  : summaryError ? <div className="panel state-panel" role="alert"><p>{summaryError}</p><button className="secondary-button" type="button" onClick={() => setSummaryReload((version) => version + 1)}>Retry</button></div>
                    : summary && summary.totalRequests === 0 ? <div className="panel empty-panel"><h2>No requests in this period</h2><p>The backend returned no matching gateway requests for {selectedApi?.name} in the selected time range.</p></div>
                      : summary && (
                        <>
                          <p className="monitoring-footnote">Backend period: {formatDate(summary.period.from)} – {formatDate(summary.period.to)}. HTTP errors are status codes 400 and above.</p>
                          <div className="monitoring-metric-grid">
                            <article className="panel monitoring-metric"><p>Total requests</p><strong>{summary.totalRequests.toLocaleString()}</strong></article>
                            <article className="panel monitoring-metric"><p>HTTP errors (≥400)</p><strong>{summary.errorCount.toLocaleString()}</strong></article>
                            <article className="panel monitoring-metric"><p>Error rate</p><strong>{new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 2 }).format(summary.errorRate)}</strong></article>
                            <article className="panel monitoring-metric"><p>Average recorded latency</p><strong>{summary.averageLatencyMs === null ? 'Not available' : `${summary.averageLatencyMs.toFixed(1)} ms`}</strong></article>
                          </div>
                          <section className="panel monitoring-intro"><h2>Status-code counts</h2>
                            {Object.keys(summary.statusCodeCounts).length ? <ul className="monitoring-status-counts">{Object.entries(summary.statusCodeCounts).sort(([a], [b]) => Number(a) - Number(b)).map(([code, count]) => <li key={code}><span className={requestStatusClass(Number(code))}>{code}</span><strong>{count.toLocaleString()}</strong></li>)}</ul> : <p>No status-code counts were reported.</p>}
                          </section>
                        </>
                      )}
              </>
            )}
          </>
        )}

        {activeTab === 'Operations' && (
          <div className="content-grid monitoring-operations">
            <section className="panel"><h2>Gateway request history</h2><p>Gateway request records are available in the Requests view. They contain sanitized paths, status, latency, and safe result metadata—not request or response bodies.</p></section>
            <section className="panel"><h2>Administrative audit logs</h2><p>Administrative audit logs are a separate, admin-only record of control-plane actions. They are not gateway traffic and are not included in this user-level monitoring view.</p></section>
            <section className="panel"><h2>Infrastructure logs</h2><p>No application endpoint currently exposes CloudWatch or other infrastructure logs. This page does not claim those logs are available.</p></section>
          </div>
        )}
      </section>
    </div>
  );
}
