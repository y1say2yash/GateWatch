import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { ApiError, apiRequest } from '../lib/api';
import type { Api, Project, RouteMethod } from '../types/management';

const methods: RouteMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export function CreateApiPage(): ReactElement {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [loadingProject, setLoadingProject] = useState(true);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [upstreamUrl, setUpstreamUrl] = useState('');
  const [upstreamBasePath, setUpstreamBasePath] = useState('');
  const [pathPrefix, setPathPrefix] = useState('');
  const [selectedMethods, setSelectedMethods] = useState<RouteMethod[]>(['GET']);
  const [authRequired, setAuthRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const submissionInProgress = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      setLoadingProject(true);
      setProjectError(null);
      try {
        const data = await apiRequest<Project>(`/api/v1/projects/${projectId}`);
        if (!cancelled) setProject(data);
      } catch (err) {
        if (!cancelled) {
          setProject(null);
          setProjectError(err instanceof ApiError && err.status === 404
            ? 'This project was not found or is no longer available.'
            : err instanceof ApiError ? err.message : 'Unable to verify this project.');
        }
      } finally {
        if (!cancelled) setLoadingProject(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [projectId]);

  const toggleMethod = (method: RouteMethod): void => {
    setSelectedMethods((current) => current.includes(method)
      ? current.filter((entry) => entry !== method)
      : [...current, method]);
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submissionInProgress.current) return;
    setFormError(null);
    if (!name.trim()) return setFormError('Enter an API name.');
    if (!pathPrefix.trim().startsWith('/') || /[?#]/.test(pathPrefix)) {
      return setFormError('Route prefix must start with / and cannot include a query or fragment.');
    }
    if (!selectedMethods.length) return setFormError('Select at least one allowed HTTP method.');
    try {
      const parsedUrl = new URL(upstreamUrl);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error();
    } catch {
      return setFormError('Enter a valid upstream URL using HTTP or HTTPS.');
    }

    submissionInProgress.current = true;
    setSubmitting(true);
    try {
      const api = await apiRequest<Api>(`/api/v1/projects/${projectId}/apis`, {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          upstreamUrl: upstreamUrl.trim(),
          upstreamBasePath: upstreamBasePath.trim() || null,
        }),
      });
      try {
        for (const method of selectedMethods) {
          await apiRequest(`/api/v1/apis/${api.id}/routes`, {
            method: 'POST',
            body: JSON.stringify({ pathPrefix: pathPrefix.trim(), method }),
          });
        }
        if (authRequired) {
          await apiRequest(`/api/v1/apis/${api.id}/authentication`, {
            method: 'PATCH',
            body: JSON.stringify({ required: true }),
          });
        }
        navigate(`/apis/${api.id}`, { replace: true, state: { successMessage: 'API registered and gateway configuration saved.' } });
      } catch (err) {
        navigate(`/apis/${api.id}`, {
          replace: true,
          state: {
            setupWarning: err instanceof ApiError
              ? `The API was registered, but some gateway configuration could not be saved: ${err.message}`
              : 'The API was registered, but some gateway configuration could not be saved. Review routes and authentication below.',
          },
        });
      }
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Unable to register this API. Please try again.');
    } finally {
      submissionInProgress.current = false;
      setSubmitting(false);
    }
  };

  if (loadingProject) return <div className="panel state-panel" role="status"><span className="loader" />Verifying project…</div>;
  if (!project || projectError) {
    return <div className="page-container"><div className="panel state-panel" role="alert"><h1>Project unavailable</h1><p>{projectError}</p><Link className="text-link" to="/projects">Back to projects</Link></div></div>;
  }

  return (
    <div className="page-container">
      <header className="page-header"><div><p className="eyebrow"><Link to={`/projects/${project.id}`}>{project.name}</Link> / Register API</p><h1>Register API</h1></div></header>
      <form className="panel management-form form-panel" onSubmit={(event) => void submit(event)}>
        <p>Connect an existing upstream API to this project. Routes are configured separately from the upstream service.</p>
        <label htmlFor="api-name">API name</label><input id="api-name" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} required />
        <label htmlFor="api-description">Description <span className="field-optional">(optional)</span></label><textarea id="api-description" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
        <label htmlFor="upstream-url">Base upstream URL</label><input id="upstream-url" type="url" placeholder="https://api.example.com" value={upstreamUrl} onChange={(event) => setUpstreamUrl(event.target.value)} required />
        <label htmlFor="upstream-base-path">Upstream base path <span className="field-optional">(optional)</span></label><input id="upstream-base-path" placeholder="/v1" value={upstreamBasePath} onChange={(event) => setUpstreamBasePath(event.target.value)} />
        <label htmlFor="public-route-prefix">Public route prefix</label><input id="public-route-prefix" placeholder="/catalog" value={pathPrefix} onChange={(event) => setPathPrefix(event.target.value)} required />
        <fieldset className="method-fieldset"><legend>Allowed HTTP methods</legend><div className="method-options">{methods.map((method) => <label key={method} className="method-option"><input type="checkbox" checked={selectedMethods.includes(method)} onChange={() => toggleMethod(method)} />{method}</label>)}</div></fieldset>
        <label className="checkbox-field"><input type="checkbox" checked={authRequired} onChange={(event) => setAuthRequired(event.target.checked)} /> Require GateWatch API key authentication</label>
        {formError && <p className="auth-error" role="alert">{formError}</p>}
        <div className="page-actions"><button className="primary-button" type="submit" disabled={submitting}>{submitting ? 'Registering…' : 'Register API'}</button><Link className="text-link" to={`/projects/${project.id}/apis`}>Cancel</Link></div>
      </form>
    </div>
  );
}
