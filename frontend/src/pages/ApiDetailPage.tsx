import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';

import { ApiError, apiRequest } from '../lib/api';
import type {
  Api,
  ApiKey,
  ApiRoute,
  CreatedApiKey,
  HealthCheckConfig,
  HealthStatusResult,
  Project,
  RateLimitConfig,
  RouteMethod,
} from '../types/management';

const routeMethods: RouteMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

interface DetailData {
  api: Api;
  project: Project;
  routes: ApiRoute[];
  rateLimit: RateLimitConfig;
  healthConfig: HealthCheckConfig;
  healthStatus: HealthStatusResult;
  keys: ApiKey[];
}

export function ApiDetailPage(): ReactElement {
  const { apiId = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(
    (location.state as { successMessage?: string } | null)?.successMessage ?? null,
  );
  const [warning] = useState<string | null>(
    (location.state as { setupWarning?: string } | null)?.setupWarning ?? null,
  );
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [upstreamUrl, setUpstreamUrl] = useState('');
  const [upstreamBasePath, setUpstreamBasePath] = useState('');
  const [pathPrefix, setPathPrefix] = useState('');
  const [routeMethod, setRouteMethod] = useState<RouteMethod>('GET');
  const [keyName, setKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState<{ apiId: string; value: string } | null>(null);
  const [rateEnabled, setRateEnabled] = useState(true);
  const [maxRequests, setMaxRequests] = useState('');
  const [windowSeconds, setWindowSeconds] = useState('');
  const [healthEnabled, setHealthEnabled] = useState(true);
  const [healthPath, setHealthPath] = useState('/');
  const [healthInterval, setHealthInterval] = useState('');
  const [healthTimeout, setHealthTimeout] = useState('');
  const [healthStatusMin, setHealthStatusMin] = useState('');
  const [healthStatusMax, setHealthStatusMax] = useState('');
  const [healthLatency, setHealthLatency] = useState('');
  const loadSequence = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const requestId = ++loadSequence.current;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const api = await apiRequest<Api>(`/api/v1/apis/${apiId}`);
      const [project, routes, rateLimit, healthConfig, healthStatus, keys] = await Promise.all([
        apiRequest<Project>(`/api/v1/projects/${api.projectId}`),
        apiRequest<ApiRoute[]>(`/api/v1/apis/${apiId}/routes`),
        apiRequest<RateLimitConfig>(`/api/v1/apis/${apiId}/rate-limit`),
        apiRequest<HealthCheckConfig>(`/api/v1/apis/${apiId}/health`),
        apiRequest<HealthStatusResult>(`/api/v1/apis/${apiId}/health/status`),
        apiRequest<ApiKey[]>(`/api/v1/apis/${apiId}/keys`),
      ]);
      if (requestId !== loadSequence.current) return;
      setData({ api, project, routes, rateLimit, healthConfig, healthStatus, keys });
      setName(api.name);
      setDescription(api.description ?? '');
      setUpstreamUrl(api.upstreamUrl);
      setUpstreamBasePath(api.upstreamBasePath ?? '');
      setRateEnabled(rateLimit.enabled);
      setMaxRequests(String(rateLimit.maxRequests));
      setWindowSeconds(String(rateLimit.windowSeconds));
      setHealthEnabled(healthConfig.enabled);
      setHealthPath(healthConfig.path);
      setHealthInterval(String(healthConfig.intervalSeconds));
      setHealthTimeout(String(healthConfig.timeoutMs));
      setHealthStatusMin(String(healthConfig.expectedStatusMin));
      setHealthStatusMax(String(healthConfig.expectedStatusMax));
      setHealthLatency(String(healthConfig.latencyThresholdMs));
    } catch (err) {
      if (requestId !== loadSequence.current) return;
      setError(err instanceof ApiError && err.status === 404
        ? 'This API was not found or is no longer available.'
        : err instanceof ApiError
          ? err.message
          : 'Unable to load this API. Please try again.');
    } finally {
      if (requestId === loadSequence.current) setLoading(false);
    }
  }, [apiId]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void load();
    });
    return () => {
      active = false;
      loadSequence.current += 1;
    };
  }, [load]);

  const updateApi = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiRequest<Api>(`/api/v1/apis/${apiId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          upstreamUrl: upstreamUrl.trim(),
          upstreamBasePath: upstreamBasePath.trim() || null,
        }),
      });
      setNotice('API details updated.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to update API details.');
    } finally {
      setSaving(false);
    }
  };

  const setAuthentication = async (required: boolean): Promise<void> => {
    if (!data) return;
    setSaving(true);
    setError(null);
    try {
      await apiRequest(`/api/v1/apis/${apiId}/authentication`, {
        method: 'PATCH',
        body: JSON.stringify({ required }),
      });
      setNotice('Authentication configuration saved.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to update authentication configuration.');
    } finally {
      setSaving(false);
    }
  };

  const addRoute = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!pathPrefix.trim().startsWith('/') || /[?#]/.test(pathPrefix)) {
      setError('Route prefix must start with / and cannot include a query or fragment.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiRequest(`/api/v1/apis/${apiId}/routes`, {
        method: 'POST',
        body: JSON.stringify({ pathPrefix: pathPrefix.trim(), method: routeMethod }),
      });
      setPathPrefix('');
      setNotice('Route created.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to create route.');
    } finally {
      setSaving(false);
    }
  };

  const changeRoute = async (route: ApiRoute): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await apiRequest(`/api/v1/routes/${route.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !route.isActive }),
      });
      setNotice('Route status updated.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to update route.');
    } finally {
      setSaving(false);
    }
  };

  const removeRoute = async (route: ApiRoute): Promise<void> => {
    if (!window.confirm(`Remove ${route.method} ${route.pathPrefix}?`)) return;
    setSaving(true);
    setError(null);
    try {
      await apiRequest<void>(`/api/v1/routes/${route.id}`, { method: 'DELETE' });
      setNotice('Route removed.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to remove route.');
    } finally {
      setSaving(false);
    }
  };

  const saveRateLimit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const max = Number(maxRequests);
    const window = Number(windowSeconds);
    if (!Number.isSafeInteger(max) || max < 1 || max > 1_000_000 || !Number.isSafeInteger(window) || window < 1 || window > 86_400) {
      setError('Maximum requests must be 1–1,000,000 and window seconds 1–86,400.');
      return;
    }
    await saveConfiguration(`/api/v1/apis/${apiId}/rate-limit`, {
      enabled: rateEnabled,
      maxRequests: max,
      windowSeconds: window,
    }, 'Rate-limit configuration saved.');
  };

  const saveHealth = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const values = [healthInterval, healthTimeout, healthStatusMin, healthStatusMax, healthLatency].map(Number);
    const [intervalSeconds, timeoutMs, expectedStatusMin, expectedStatusMax, latencyThresholdMs] = values;
    if (
      !values.every(Number.isSafeInteger) ||
      intervalSeconds < 1 || intervalSeconds > 86_400 ||
      timeoutMs < 1 || timeoutMs > 5_000 ||
      expectedStatusMin < 100 || expectedStatusMin > 599 ||
      expectedStatusMax < 100 || expectedStatusMax > 599 ||
      expectedStatusMin > expectedStatusMax ||
      latencyThresholdMs < 1 || latencyThresholdMs > 60_000 ||
      !healthPath.startsWith('/') || healthPath.length > 2048 || /[#\r\n]/.test(healthPath)
    ) {
      setError('Check the health-check values: path must be absolute; interval 1–86,400s; timeout 1–5,000ms; status 100–599; latency 1–60,000ms.');
      return;
    }
    await saveConfiguration(`/api/v1/apis/${apiId}/health`, {
      enabled: healthEnabled,
      path: healthPath,
      intervalSeconds,
      timeoutMs,
      expectedStatusMin,
      expectedStatusMax,
      latencyThresholdMs,
    }, 'Health-check configuration saved.');
  };

  const saveConfiguration = async (path: string, body: object, successMessage: string): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await apiRequest(path, { method: 'PATCH', body: JSON.stringify(body) });
      setNotice(successMessage);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to save configuration.');
    } finally {
      setSaving(false);
    }
  };

  const createKey = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!keyName.trim()) {
      setError('Enter a name for this API key.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await apiRequest<CreatedApiKey>(`/api/v1/apis/${apiId}/keys`, {
        method: 'POST',
        body: JSON.stringify({ name: keyName.trim() }),
      });
      setCreatedKey({ apiId, value: result.key });
      setKeyName('');
      setNotice('API key created. Copy it now; it will not be shown again.');
      await load();
      setCreatedKey({ apiId, value: result.key });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to create API key.');
    } finally {
      setSaving(false);
    }
  };

  const revokeKey = async (key: ApiKey): Promise<void> => {
    if (!window.confirm(`Revoke the API key “${key.name}”? This cannot be undone.`)) return;
    setSaving(true);
    setError(null);
    try {
      await apiRequest<void>(`/api/v1/api-keys/${key.id}`, { method: 'DELETE' });
      setNotice('API key revoked.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to revoke API key.');
    } finally {
      setSaving(false);
    }
  };

  const changeLifecycle = async (action: 'enable' | 'disable'): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await apiRequest(`/api/v1/apis/${apiId}/${action}`, { method: 'POST' });
      setNotice(`API ${action === 'enable' ? 'enabled' : 'disabled'}.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Unable to ${action} this API.`);
    } finally {
      setSaving(false);
    }
  };

  const deleteApi = async (): Promise<void> => {
    if (!window.confirm('Delete this API? It will be soft-deleted and its routes will be removed.')) return;
    setSaving(true);
    setError(null);
    try {
      await apiRequest<void>(`/api/v1/apis/${apiId}`, { method: 'DELETE' });
      navigate(data ? `/projects/${data.project.id}/apis` : '/projects', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to delete this API.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="panel state-panel" role="status"><span className="loader" />Loading API details…</div>;
  if (error && !data) {
    return <div className="page-container"><div className="panel state-panel" role="alert"><h1>API unavailable</h1><p>{error}</p>{createdKey?.apiId === apiId && <div className="one-time-secret"><strong>Copy the new API key now. It will not be shown again.</strong><code>{createdKey.value}</code></div>}{error.includes('not found') ? <Link className="text-link" to="/projects">Back to projects</Link> : <button className="secondary-button" onClick={() => void load()}>Retry</button>}</div></div>;
  }
  if (!data) return <div className="page-container"><div className="panel state-panel">API details are not available.</div></div>;

  return (
    <div className="page-container">
      <header className="page-header">
        <div><p className="eyebrow"><Link to={`/projects/${data.project.id}`}>{data.project.name}</Link> / <Link to={`/projects/${data.project.id}/apis`}>APIs</Link></p><h1>{data.api.name}</h1></div>
        <div className="page-actions">
          <span className={`status-badge lifecycle-${data.api.status.toLowerCase()}`}>{data.api.status}</span>
          <span className={`status-badge health-${data.healthStatus.healthStatus.toLowerCase()}`}>{data.healthStatus.healthStatus}</span>
          {data.api.status === 'ACTIVE'
            ? <button className="secondary-button" disabled={saving} onClick={() => void changeLifecycle('disable')}>Disable API</button>
            : <button className="secondary-button" disabled={saving} onClick={() => void changeLifecycle('enable')}>Enable API</button>}
          <button className="danger-button" disabled={saving} onClick={() => void deleteApi()}>Delete API</button>
        </div>
      </header>
      {warning && <p className="auth-error" role="alert">{warning}</p>}
      {error && <p className="auth-error" role="alert">{error}</p>}
      {notice && <p className="success-message" role="status">{notice}</p>}

      <section className="panel management-section">
        <header className="section-header"><div><p className="eyebrow">Configuration</p><h2>Upstream</h2></div></header>
        <form className="management-form" onSubmit={(event) => void updateApi(event)}>
          <label htmlFor="detail-api-name">API name</label><input id="detail-api-name" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} required />
          <label htmlFor="detail-api-description">Description</label><textarea id="detail-api-description" rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />
          <label htmlFor="detail-api-url">Base upstream URL</label><input id="detail-api-url" type="url" value={upstreamUrl} onChange={(event) => setUpstreamUrl(event.target.value)} required />
          <label htmlFor="detail-api-base-path">Upstream base path</label><input id="detail-api-base-path" value={upstreamBasePath} onChange={(event) => setUpstreamBasePath(event.target.value)} />
          <button className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save upstream'}</button>
        </form>
        <dl className="detail-list"><div><dt>Project</dt><dd><Link className="text-link" to={`/projects/${data.project.id}`}>{data.project.name}</Link></dd></div><div><dt>Created</dt><dd><time dateTime={data.api.createdAt}>{new Date(data.api.createdAt).toLocaleString()}</time></dd></div><div><dt>Updated</dt><dd><time dateTime={data.api.updatedAt}>{new Date(data.api.updatedAt).toLocaleString()}</time></dd></div></dl>
        <div className="checkbox-field"><input id="api-auth-required" type="checkbox" checked={data.api.authRequired} disabled={saving} onChange={(event) => void setAuthentication(event.target.checked)} /><label htmlFor="api-auth-required">Require GateWatch API key authentication</label></div>
      </section>

      <section className="panel management-section">
        <header className="section-header"><div><p className="eyebrow">Gateway</p><h2>Routes</h2></div></header>
        {data.routes.length ? <div className="table-scroll"><table className="api-table"><thead><tr><th>Prefix</th><th>Method</th><th>Status</th><th>Actions</th></tr></thead><tbody>{data.routes.map((route) => <tr key={route.id}><td>{route.pathPrefix}</td><td>{route.method}</td><td>{route.isActive ? 'Active' : 'Disabled'}</td><td><button className="text-button" disabled={saving} onClick={() => void changeRoute(route)}>{route.isActive ? 'Disable' : 'Enable'}</button><button className="text-button danger-text" disabled={saving} onClick={() => void removeRoute(route)}>Remove</button></td></tr>)}</tbody></table></div> : <p>No routes are configured for this API.</p>}
        <form className="inline-management-form" onSubmit={(event) => void addRoute(event)}>
          <label htmlFor="route-prefix">Add route prefix</label><input id="route-prefix" value={pathPrefix} onChange={(event) => setPathPrefix(event.target.value)} placeholder="/v1/resource" required />
          <label htmlFor="route-method">Method</label><select id="route-method" value={routeMethod} onChange={(event) => setRouteMethod(event.target.value as RouteMethod)}>{routeMethods.map((method) => <option key={method}>{method}</option>)}</select>
          <button className="secondary-button" disabled={saving}>Add route</button>
        </form>
      </section>

      <div className="content-grid management-section">
        <section className="panel">
          <h2>Rate limit</h2>
          <form className="management-form compact-form" onSubmit={(event) => void saveRateLimit(event)}>
            <label className="checkbox-field"><input type="checkbox" checked={rateEnabled} onChange={(event) => setRateEnabled(event.target.checked)} />Enable fixed-window rate limit</label>
            <label htmlFor="rate-limit-max">Maximum requests</label><input id="rate-limit-max" type="number" min="1" max="1000000" value={maxRequests} onChange={(event) => setMaxRequests(event.target.value)} required />
            <label htmlFor="rate-limit-window">Window (seconds)</label><input id="rate-limit-window" type="number" min="1" max="86400" value={windowSeconds} onChange={(event) => setWindowSeconds(event.target.value)} required />
            <button className="secondary-button" disabled={saving}>Save rate limit</button>
          </form>
        </section>

        <section className="panel">
          <h2>Health-check configuration</h2>
          <form className="management-form compact-form" onSubmit={(event) => void saveHealth(event)}>
            <label className="checkbox-field"><input type="checkbox" checked={healthEnabled} onChange={(event) => setHealthEnabled(event.target.checked)} />Enable health checks</label>
            <label htmlFor="health-path">Path</label><input id="health-path" value={healthPath} onChange={(event) => setHealthPath(event.target.value)} required />
            <label htmlFor="health-interval">Interval (seconds)</label><input id="health-interval" type="number" value={healthInterval} onChange={(event) => setHealthInterval(event.target.value)} required />
            <label htmlFor="health-timeout">Timeout (milliseconds)</label><input id="health-timeout" type="number" value={healthTimeout} onChange={(event) => setHealthTimeout(event.target.value)} required />
            <label htmlFor="health-status-min">Expected status minimum</label><input id="health-status-min" type="number" value={healthStatusMin} onChange={(event) => setHealthStatusMin(event.target.value)} required />
            <label htmlFor="health-status-max">Expected status maximum</label><input id="health-status-max" type="number" value={healthStatusMax} onChange={(event) => setHealthStatusMax(event.target.value)} required />
            <label htmlFor="health-latency">Latency threshold (milliseconds)</label><input id="health-latency" type="number" value={healthLatency} onChange={(event) => setHealthLatency(event.target.value)} required />
            <button className="secondary-button" disabled={saving}>Save health config</button>
          </form>
        </section>
      </div>

      <section className="panel management-section">
        <header className="section-header"><div><p className="eyebrow">Credentials</p><h2>API keys</h2></div></header>
        <p>Key secrets are shown only once. Copy a new key securely; it is not stored in browser storage.</p>
        {createdKey?.apiId === apiId && <div className="one-time-secret" role="alert"><strong>Copy this key now. It will not be shown again.</strong><code>{createdKey.value}</code><button className="text-button" onClick={() => setCreatedKey(null)}>Dismiss</button></div>}
        {data.keys.length ? <div className="table-scroll"><table className="api-table"><thead><tr><th>Name</th><th>Prefix</th><th>Created</th><th>Last used</th><th>Status</th><th>Action</th></tr></thead><tbody>{data.keys.map((key) => <tr key={key.id}><td>{key.name}</td><td><code>{key.keyPrefix}</code></td><td><time dateTime={key.createdAt}>{new Date(key.createdAt).toLocaleDateString()}</time></td><td>{key.lastUsedAt ? <time dateTime={key.lastUsedAt}>{new Date(key.lastUsedAt).toLocaleString()}</time> : 'Never'}</td><td>{key.revokedAt ? 'Revoked' : 'Active'}</td><td>{!key.revokedAt && <button className="text-button danger-text" disabled={saving} onClick={() => void revokeKey(key)}>Revoke</button>}</td></tr>)}</tbody></table></div> : <p>No API keys have been created for this API.</p>}
        <form className="inline-management-form" onSubmit={(event) => void createKey(event)}><label htmlFor="api-key-name">New key name</label><input id="api-key-name" value={keyName} maxLength={100} onChange={(event) => setKeyName(event.target.value)} required /><button className="secondary-button" disabled={saving}>{saving ? 'Creating…' : 'Create API key'}</button></form>
      </section>
    </div>
  );
}
