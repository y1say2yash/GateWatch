import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { MonitoringBarChart, MonitoringChart, MonitoringPieChart } from '../components/MonitoringCharts';
import type { Alert } from '../features/alerts/types';
import { ApiError, apiRequest, apiRequestEnvelope } from '../lib/api';
import type { Api, ApiRoute, HealthStatus, Project } from '../types/management';
import type {
  ApiHealthConfiguration,
  ApiHealthHistoryEntry,
  ApiHealthOverviewEntry,
  ApiHealthStatus,
  GatewayRoute,
  MonitoringSummary,
  MonitoringTimeSeries,
  RequestHistoryRecord,
} from '../types/monitoring';

const monitoringTabs = ['Gateway', 'Requests', 'API health', 'Health history', 'Metrics', 'Operations'] as const;
type MonitoringTab = typeof monitoringTabs[number];
const maximumMetricRangeMs = 90 * 24 * 60 * 60 * 1_000;

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


function statusCodeChartItems(summary: MonitoringSummary): { label: string; value: number; color: string }[] {
  const statusCodeColor = (code: number): string => {
    if (code >= 100 && code < 200) return '#64748b'; // 1xx: grey
    if (code >= 200 && code < 300) return '#059669'; // 2xx: green
    if (code >= 300 && code < 400) return '#2563eb'; // 3xx: blue
    if (code >= 400 && code < 500) return '#d97706'; // 4xx: orange
    if (code >= 500 && code < 600) return '#dc2626'; // 5xx: red
    return '#7c3aed'; // Other / unknown
  };

  return Object.entries(summary.statusCodeCounts)
    .filter(([code, count]) =>
      /^\d+$/.test(code) &&
      Number.isFinite(count) &&
      count > 0
    )
    .sort(([first], [second]) => Number(first) - Number(second))
    .map(([code, value]) => ({
      label: code,
      value,
      color: statusCodeColor(Number(code)),
    }));
}


export function MonitoringPage(): ReactElement {
  const [activeTab, setActiveTab] = useState<MonitoringTab>('Metrics');
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
  const [metricRange, setMetricRange] = useState<MetricRange>(metricInputs);
  const [metricRangeError, setMetricRangeError] = useState<string | null>(null);
  const [summary, setSummary] = useState<MonitoringSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryReload, setSummaryReload] = useState(0);
  const [timeSeries, setTimeSeries] = useState<MonitoringTimeSeries | null>(null);
  const [operationAlerts, setOperationAlerts] = useState<Alert[]>([]);
  const [loadingOperations, setLoadingOperations] = useState(false);
  const [operationsError, setOperationsError] = useState<string | null>(null);
  const [operationsReload, setOperationsReload] = useState(0);
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
    const apiEntries = inventory?.apis;
    if (activeTab !== 'API health' || !apiEntries?.length) return;
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setLoadingHealth(true);
      setHealthError(null);
      try {
        const rows = await Promise.all(apiEntries.map(async ({ api, project }) => {
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
  }, [activeTab, inventory?.apis, healthReload]);

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
        setTimeSeries(null);
        setSummaryError('Choose a valid time range where the start is not later than the end.');
        setLoadingSummary(false);
        return;
      }
      const params = new URLSearchParams({ from, to });
      try {
        const [result, series] = await Promise.all([
          apiRequest<MonitoringSummary>(
            `/api/v1/apis/${effectiveApiId}/monitoring/summary?${params.toString()}`,
          ),
          apiRequest<MonitoringTimeSeries>(
            `/api/v1/apis/${effectiveApiId}/monitoring/timeseries?${params.toString()}`,
          ),
        ]);
        if (active) {
          setSummary(result);
          setTimeSeries(series);
        }
      } catch (error) {
        if (active) {
          setSummary(null);
          setTimeSeries(null);
          setSummaryError(getErrorMessage(error, 'Unable to load monitoring metrics. Please try again.'));
        }
      } finally {
        if (active) setLoadingSummary(false);
      }
    });
    return () => { active = false; };
  }, [activeTab, effectiveApiId, metricRange, summaryReload]);

  useEffect(() => {
    const apiEntries = inventory?.apis;
    if (activeTab !== 'Operations' || !apiEntries) return;
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setLoadingOperations(true);
      setOperationsError(null);
      try {
        const results = await Promise.allSettled(apiEntries.map(({ api }) =>
          apiRequest<Alert[]>(`/api/v1/apis/${api.id}/alerts`),
        ));
        const failures = results.filter((result) => result.status === 'rejected').length;
        const alerts = results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
        if (active) {
          setOperationAlerts(alerts);
          setOperationsError(failures ? `${failures} API alert configuration${failures === 1 ? '' : 's'} could not be loaded.` : null);
        }
      } catch (error) {
        if (active) {
          setOperationAlerts([]);
          setOperationsError(getErrorMessage(error, 'Unable to load operational data. Please try again.'));
        }
      } finally {
        if (active) setLoadingOperations(false);
      }
    });
    return () => { active = false; };
  }, [activeTab, inventory?.apis, operationsReload]);

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
    if (new Date(to).getTime() - new Date(from).getTime() > maximumMetricRangeMs) {
      setMetricRangeError('Choose a time range of 90 days or less to view monitoring graphs.');
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
              <>
                <div className="monitoring-chart-grid">
                  <MonitoringBarChart
                    title="Configured routes by project"
                    description="Count of configured routes only; this does not represent gateway traffic."
                    axisLabel="Configured routes"
                    items={inventory.projects.map((project) => ({
                      label: project.name,
                      value: inventory.routes.filter(({ project: routeProject }) => routeProject.id === project.id).length,
                      color: '#2563eb',
                    })).filter((item) => item.value > 0)}
                  />
                  <MonitoringBarChart
                    title="Configured routes by method"
                    description="Configured route counts grouped by HTTP method."
                    axisLabel="Configured routes"
                    items={['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
                      .map((method, index) => ({
                        label: method,
                        value: inventory.routes.filter(({ route }) => route.method === method).length,
                        color: ['#2563eb', '#059669', '#0891b2', '#7c3aed', '#d97706', '#64748b', '#0f766e'][index] ?? '#64748b',
                      }))
                      .filter((item) => item.value > 0)}
                  />
                </div>
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
              </>
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
                {!loadingRequests && !requestError && requestRows.length > 0 && (
                  <div className="monitoring-chart-grid">
                    <MonitoringBarChart
                      title="Response classes on this page"
                      description={`HTTP status classes among the ${requestRows.length} requests currently loaded for ${selectedApi?.name}. Filters and pagination affect this chart; it is not a full-period aggregate.`}
                      axisLabel="Requests on this page"
                      items={[
                        { label: '2xx successful', value: requestRows.filter((row) => row.statusCode >= 200 && row.statusCode < 300).length, color: '#059669' },
                        { label: '3xx redirection', value: requestRows.filter((row) => row.statusCode >= 300 && row.statusCode < 400).length, color: '#2563eb' },
                        { label: '4xx client errors', value: requestRows.filter((row) => row.statusCode >= 400 && row.statusCode < 500).length, color: '#d97706' },
                        { label: '5xx server errors', value: requestRows.filter((row) => row.statusCode >= 500 && row.statusCode < 600).length, color: '#dc2626' },
                        { label: 'Other status codes', value: requestRows.filter((row) => row.statusCode < 200 || row.statusCode >= 600).length, color: '#64748b' },
                      ]}
                    />
                  </div>
                )}
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
                    <>
                      <div className="monitoring-chart-grid">
                        <MonitoringBarChart
                          title="Latest API health states"
                          description="Counts use each API's latest recorded health check. APIs without a check are shown as not checked, not healthy."
                          axisLabel="APIs"
                          items={[
                            { label: 'Healthy', value: healthRows.filter(({ status }) => Boolean(status.lastHealthCheckAt) && status.healthStatus === 'HEALTHY').length, color: '#059669' },
                            { label: 'Degraded', value: healthRows.filter(({ status }) => Boolean(status.lastHealthCheckAt) && status.healthStatus === 'DEGRADED').length, color: '#d97706' },
                            { label: 'Down', value: healthRows.filter(({ status }) => Boolean(status.lastHealthCheckAt) && status.healthStatus === 'DOWN').length, color: '#dc2626' },
                            { label: 'Not checked', value: healthRows.filter(({ status }) => !status.lastHealthCheckAt).length, color: '#64748b' },
                          ]}
                        />
                        <MonitoringBarChart
                          title="Latest recorded response latency"
                          description="One most-recent recorded response time per API. APIs without a latency observation are omitted, not treated as zero."
                          axisLabel="Response time (ms)"
                          valueFormat={(value) => `${value.toFixed(1)} ms`}
                          items={healthRows.flatMap(({ api, status }) => {
                            const responseTimeMs = status.latestCheck?.responseTimeMs;
                            return responseTimeMs === null || responseTimeMs === undefined
                              ? []
                              : [{ label: api.name, value: responseTimeMs, color: '#0891b2' }];
                          })}
                        />
                      </div>
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
                    </>
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
                        <>
                          <div className="monitoring-chart-grid">
                            <MonitoringChart
                              title="Health-check response time"
                              description={`Recorded response times for the ${healthHistory.length} most recent health checks. Missing response times remain gaps; failed observations are not converted to zero.`}
                              axisLabel="Response time (ms)"
                              points={healthHistory
                                .filter((record) => Number.isFinite(new Date(record.checkedAt).getTime()))
                                .slice()
                                .sort((left, right) => new Date(left.checkedAt).getTime() - new Date(right.checkedAt).getTime())
                                .map((record) => ({
                                  bucketStart: record.checkedAt,
                                  requestCount: 0,
                                  statusCounts: { informational: 0, successful: 0, redirection: 0, clientError: 0, serverError: 0, other: 0 },
                                  latencyCount: record.responseTimeMs === null ? 0 : 1,
                                  averageLatencyMs: record.responseTimeMs,
                                }))}
                              bucketSize="hour"
                              valueFormat={(value) => `${value.toFixed(1)} ms`}
                              series={[{
                                key: 'response-time',
                                label: 'Response time',
                                color: '#0891b2',
                                value: (point) => point.averageLatencyMs,
                              }]}
                            />
                            <MonitoringBarChart
                              title="Health-check outcomes"
                              description={`Outcome counts within the ${healthHistory.length} most recent records returned by the backend.`}
                              axisLabel="Recorded checks"
                              items={[
                                { label: 'Healthy', value: healthHistory.filter(({ status }) => status === 'HEALTHY').length, color: '#059669' },
                                { label: 'Degraded', value: healthHistory.filter(({ status }) => status === 'DEGRADED').length, color: '#d97706' },
                                { label: 'Down', value: healthHistory.filter(({ status }) => status === 'DOWN').length, color: '#dc2626' },
                              ]}
                            />
                          </div>
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
                        </>
                      )}
              </>
            )}
          </>
        )}

        {activeTab === 'Metrics' && (
          <>
            {inventory.apis.length === 0 ? renderInventoryEmpty() : (
              <div className="monitoring-layout">
                <aside className="panel monitoring-filter-panel" aria-label="Monitoring filters">
                  <p className="eyebrow">Filters</p>
                  <h2>Request metrics</h2>
                  <p>Backend aggregates for one API and an inclusive time range.</p>
                  <label className="monitoring-api-select" htmlFor="metrics-api">API</label>
                  <select id="metrics-api" value={effectiveApiId} onChange={(event) => setSelectedApiId(event.target.value)}>
                    {inventory.apis.map((entry) => <option key={entry.api.id} value={entry.api.id}>{apiLabel(entry)}</option>)}
                  </select>
                  <form className="monitoring-filter-form metric-range-form" onSubmit={submitMetricRange}>
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
                  <p className="monitoring-active-range">
                    Applied range: {new Date(metricRange.from).toLocaleString()} – {new Date(metricRange.to).toLocaleString()}
                  </p>
                </aside>
                <div className="monitoring-results">
                  {loadingSummary ? <div className="panel state-panel" role="status"><span className="loader" />Loading metrics…</div>
                    : summaryError ? <div className="panel state-panel" role="alert"><p>{summaryError}</p><button className="secondary-button" type="button" onClick={() => setSummaryReload((version) => version + 1)}>Retry</button></div>
                      : summary && summary.totalRequests === 0 ? <div className="panel empty-panel"><h2>No requests in this period</h2><p>The backend returned no matching gateway requests for {selectedApi?.name} in the selected time range. Time-series graphs will populate when requests pass through GateWatch.</p></div>
                        : summary && (
                          <>
                            <p className="monitoring-footnote">Backend period: {formatDate(summary.period.from)} – {formatDate(summary.period.to)}. HTTP errors are status codes 400 and above.</p>
                            <div className="monitoring-metric-grid">
                              <article className="panel monitoring-metric"><p>Total requests</p><strong>{summary.totalRequests.toLocaleString()}</strong></article>
                              <article className="panel monitoring-metric"><p>HTTP errors (≥400)</p><strong>{summary.errorCount.toLocaleString()}</strong></article>
                              <article className="panel monitoring-metric"><p>Error rate</p><strong>{new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 2 }).format(summary.errorRate)}</strong></article>
                              <article className="panel monitoring-metric"><p>Average recorded latency</p><strong>{summary.averageLatencyMs === null ? 'Not available' : `${summary.averageLatencyMs.toFixed(1)} ms`}</strong></article>
                            </div>
                            <div className="monitoring-chart-grid">
                              {timeSeries && (
                                <>
                                  <MonitoringChart
                                    title="Request traffic over time"
                                    description={`Request volume per ${timeSeries.bucketSize} from persisted request-history records.`}
                                    axisLabel="Requests"
                                    points={timeSeries.buckets}
                                    bucketSize={timeSeries.bucketSize}
                                    valueFormat={(value) => Math.round(value).toLocaleString()}
                                    series={[{
                                      key: 'requests',
                                      label: 'Requests',
                                      color: '#2563eb',
                                      value: (point) => point.requestCount,
                                    }]}
                                  />
                                  <MonitoringChart
                                    title="HTTP response trends"
                                    description="Response counts per time bucket, grouped by recorded HTTP status class. Other includes out-of-range status codes."
                                    axisLabel="Responses"
                                    points={timeSeries.buckets}
                                    bucketSize={timeSeries.bucketSize}
                                    valueFormat={(value) => Math.round(value).toLocaleString()}
                                    series={[
                                      { key: 'informational', label: '1xx informational', color: '#64748b', value: (point) => point.statusCounts.informational },
                                      { key: 'successful', label: '2xx successful', color: '#059669', value: (point) => point.statusCounts.successful },
                                      { key: 'redirection', label: '3xx redirection', color: '#2563eb', value: (point) => point.statusCounts.redirection },
                                      { key: 'client-error', label: '4xx client errors', color: '#d97706', value: (point) => point.statusCounts.clientError },
                                      { key: 'server-error', label: '5xx server errors', color: '#dc2626', value: (point) => point.statusCounts.serverError },
                                      { key: 'other', label: 'Other / unknown', color: '#7c3aed', value: (point) => point.statusCounts.other },
                                    ]}
                                  />
                                  <MonitoringChart
                                    title="Response latency over time"
                                    description="Average of recorded response latencies in each time bucket; this is not a percentile."
                                    axisLabel="Average latency (ms)"
                                    points={timeSeries.buckets}
                                    bucketSize={timeSeries.bucketSize}
                                    valueFormat={(value) => value.toFixed(1)}
                                    series={[{
                                      key: 'average-latency',
                                      label: 'Average latency',
                                      color: '#0891b2',
                                      value: (point) => point.averageLatencyMs,
                                    }]}
                                  />
                                </>
                              )}
                              <MonitoringPieChart
                                title="HTTP status-code counts"
                                description="Recorded response counts for each HTTP status code in the selected range."
                                items={statusCodeChartItems(summary)}
                              />
                            </div>
                          </>
                        )}
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'Operations' && (
          inventory.apis.length === 0 ? renderInventoryEmpty() : (
            <>
              <section className="panel monitoring-intro">
                <h2>Alert operations</h2>
                <p>These charts summarize configured alerts across your APIs. They do not represent gateway traffic, test executions, or infrastructure logs.</p>
                <p className="monitoring-footnote">Gateway request history is in Requests. Administrative audit logs are separate, admin-only records; infrastructure logs are not exposed by the current application API.</p>
              </section>
              {loadingOperations ? <div className="panel state-panel" role="status"><span className="loader" />Loading alert configurations…</div>
                : operationsError && operationAlerts.length === 0 ? (
                  <div className="panel state-panel" role="alert">
                    <p>{operationsError}</p>
                    <button className="secondary-button" type="button" onClick={() => setOperationsReload((version) => version + 1)}>Retry</button>
                  </div>
                ) : operationAlerts.length === 0 ? (
                  <>
                    {operationsError && <p className="dashboard-partial-warning" role="status">{operationsError} Available results are shown.</p>}
                    <div className="panel empty-panel">
                      <h2>No alert configurations yet</h2>
                      <p>Create an alert for one of your APIs to monitor its operational state here.</p>
                      <Link className="primary-button inline-link" to="/alerts">Manage alerts</Link>
                    </div>
                  </>
                ) : (
                  <>
                    {operationsError && <p className="dashboard-partial-warning" role="status">{operationsError} Available results are shown.</p>}
                    <div className="monitoring-chart-grid">
                      <MonitoringBarChart
                        title="Alert runtime state"
                        description="Current configured alerts grouped by enabled state and their recorded runtime state."
                        axisLabel="Alert configurations"
                        items={[
                          { label: 'Enabled · triggered', value: operationAlerts.filter((alert) => alert.enabled && alert.runtimeState === 'TRIGGERED').length, color: '#dc2626' },
                          { label: 'Enabled · inactive', value: operationAlerts.filter((alert) => alert.enabled && alert.runtimeState === 'INACTIVE').length, color: '#059669' },
                          { label: 'Disabled', value: operationAlerts.filter((alert) => !alert.enabled).length, color: '#64748b' },
                        ]}
                      />
                      <MonitoringBarChart
                        title="Alert configurations by type"
                        description="Configured alert rules grouped by their actual type."
                        axisLabel="Alert configurations"
                        items={[
                          { label: 'API down', value: operationAlerts.filter(({ type }) => type === 'API_DOWN').length, color: '#dc2626' },
                          { label: 'Unhealthy duration', value: operationAlerts.filter(({ type }) => type === 'UNHEALTHY_DURATION').length, color: '#d97706' },
                          { label: 'Error rate', value: operationAlerts.filter(({ type }) => type === 'ERROR_RATE').length, color: '#7c3aed' },
                          { label: 'Latency', value: operationAlerts.filter(({ type }) => type === 'LATENCY').length, color: '#0891b2' },
                        ]}
                      />
                    </div>
                    <div className="panel monitoring-operations">
                      <h2>Related operational views</h2>
                      <p>Request history contains sanitized paths, status, latency, and safe result metadata—not request or response bodies. Administrative audit logs are separate, admin-only records. CloudWatch and other infrastructure logs are not exposed through the current application API.</p>
                      <div className="monitoring-quick-links">
                        <Link className="text-link" to="/monitoring">View request metrics</Link>
                        <Link className="text-link" to="/alerts">Manage alert configurations</Link>
                        <Link className="text-link" to="/testing">Manage API tests</Link>
                      </div>
                    </div>
                  </>
                )}
            </>
          )
        )}
      </section>
    </div>
  );
}
