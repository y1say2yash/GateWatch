import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';

import { ApiError, apiRequest } from '../lib/api';
import type { Api, HealthStatus, HealthStatusResult, Project } from '../types/management';

export function ProjectApisPage(): ReactElement {
  const { projectId = '' } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [apis, setApis] = useState<Api[]>([]);
  const [health, setHealth] = useState<Record<string, HealthStatus | 'UNAVAILABLE'>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadSequence = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const requestId = ++loadSequence.current;
    setLoading(true);
    setError(null);
    setProject(null);
    setApis([]);
    setHealth({});
    try {
      const [loadedProject, loadedApis] = await Promise.all([
        apiRequest<Project>(`/api/v1/projects/${projectId}`),
        apiRequest<Api[]>(`/api/v1/projects/${projectId}/apis`),
      ]);
      if (requestId !== loadSequence.current) return;
      setProject(loadedProject);
      setApis(loadedApis);
      const healthResults = await Promise.all(
        loadedApis.map(async (api) => {
          try {
            const status = await apiRequest<HealthStatusResult>(`/api/v1/apis/${api.id}/health/status`);
            return [api.id, status.healthStatus] as const;
          } catch {
            return [api.id, 'UNAVAILABLE'] as const;
          }
        }),
      );
      if (requestId === loadSequence.current) setHealth(Object.fromEntries(healthResults));
    } catch (err) {
      if (requestId !== loadSequence.current) return;
      setError(err instanceof ApiError && err.status === 404
        ? 'This project was not found or is no longer available.'
        : err instanceof ApiError
          ? err.message
          : 'Unable to load APIs for this project. Please try again.');
    } finally {
      if (requestId === loadSequence.current) setLoading(false);
    }
  }, [projectId]);

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

  if (loading) return <div className="panel state-panel" role="status"><span className="loader" />Loading APIs…</div>;
  if (error || !project) {
    return (
      <div className="page-container">
        <div className="panel state-panel" role="alert">
          <h1>Project APIs unavailable</h1><p>{error ?? 'This project was not found.'}</p>
          {error?.includes('not found') ? <Link className="text-link" to="/projects">Back to projects</Link> : <button className="secondary-button" onClick={() => void load()}>Retry</button>}
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <header className="page-header">
        <div><p className="eyebrow"><Link to={`/projects/${project.id}`}>{project.name}</Link> / APIs</p><h1>Project APIs</h1></div>
        <div className="page-actions">
          <button className="secondary-button" onClick={() => void load()}>Refresh</button>
          <Link className="primary-button inline-link" to={`/projects/${project.id}/apis/new`}>Register API</Link>
        </div>
      </header>
      {apis.length ? (
        <div className="api-table-wrap">
          <table className="api-table">
            <thead><tr><th scope="col">API</th><th scope="col">Upstream</th><th scope="col">Lifecycle</th><th scope="col">Health</th><th scope="col">Updated</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
            <tbody>
              {apis.map((api) => (
                <tr key={api.id}>
                  <td><strong>{api.name}</strong><span>{api.description || 'No description'}</span></td>
                  <td className="resource-url">{api.upstreamUrl}{api.upstreamBasePath ?? ''}</td>
                  <td><span className={`status-badge lifecycle-${api.status.toLowerCase()}`}>{api.status}</span></td>
                  <td><HealthBadge status={health[api.id]} /></td>
                  <td><time dateTime={api.updatedAt}>{new Date(api.updatedAt).toLocaleDateString()}</time></td>
                  <td><Link className="text-link" to={`/apis/${api.id}`}>Manage</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="panel empty-panel"><div className="empty-mark" aria-hidden="true">API</div><h2>No APIs in {project.name}</h2><p>Register an existing upstream API to configure routes and access controls.</p><Link className="primary-button inline-link" to={`/projects/${project.id}/apis/new`}>Register API</Link></div>
      )}
    </div>
  );
}

function HealthBadge({ status }: { status: HealthStatus | 'UNAVAILABLE' | undefined }): ReactElement {
  if (status === 'UNAVAILABLE') return <span className="status-badge health-unavailable">Unavailable</span>;
  if (!status) return <span className="status-badge lifecycle-unknown">Not reported</span>;
  return <span className={`status-badge health-${status.toLowerCase()}`}>{status}</span>;
}
