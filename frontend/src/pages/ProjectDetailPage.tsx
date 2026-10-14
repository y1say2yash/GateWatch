import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { ApiError, apiRequest } from '../lib/api';
import type { Api, Project } from '../types/management';

export function ProjectDetailPage(): ReactElement {
  const { projectId = '' } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [apis, setApis] = useState<Api[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const navigate = useNavigate();
  const loadSequence = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const requestId = ++loadSequence.current;
    setLoading(true);
    setError(null);
    setProject(null);
    try {
      const [loadedProject, loadedApis] = await Promise.all([
        apiRequest<Project>(`/api/v1/projects/${projectId}`),
        apiRequest<Api[]>(`/api/v1/projects/${projectId}/apis`),
      ]);
      if (requestId !== loadSequence.current) return;
      setProject(loadedProject);
      setApis(loadedApis);
      setName(loadedProject.name);
      setSlug(loadedProject.slug);
      setDescription(loadedProject.description ?? '');
    } catch (err) {
      if (requestId !== loadSequence.current) return;
      setProject(null);
      setApis([]);
      setError(err instanceof ApiError && err.status === 404
        ? 'This project was not found or is no longer available.'
        : err instanceof ApiError
          ? err.message
          : 'Unable to load this project. Please try again.');
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

  const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setFormError(null);
    if (!name.trim() || !slug.trim() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.trim().toLowerCase())) {
      setFormError('Provide a project name and a valid lowercase slug.');
      return;
    }
    setSaving(true);
    try {
      const updated = await apiRequest<Project>(`/api/v1/projects/${projectId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: name.trim(), slug: slug.trim().toLowerCase(), description: description.trim() || null }),
      });
      setProject(updated);
      setEditing(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Unable to update this project.');
    } finally {
      setSaving(false);
    }
  };

  const deleteProject = async (): Promise<void> => {
    if (!window.confirm('Delete this project? Its APIs and routes will also be soft-deleted.')) return;
    setDeleting(true);
    setError(null);
    try {
      await apiRequest<void>(`/api/v1/projects/${projectId}`, { method: 'DELETE' });
      navigate('/projects', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to delete this project.');
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <div className="panel state-panel" role="status"><span className="loader" />Loading project…</div>;
  if (error || !project) {
    return (
      <div className="page-container">
        <div className="panel state-panel" role="alert">
          <h1>Project unavailable</h1><p>{error ?? 'This project was not found.'}</p>
          {error?.includes('not found') ? <Link className="text-link" to="/projects">Back to projects</Link> : <button className="secondary-button" onClick={() => void load()}>Retry</button>}
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <header className="page-header">
        <div><p className="eyebrow"><Link to="/projects">Projects</Link> / {project.slug}</p><h1>{project.name}</h1></div>
        <div className="page-actions">
          <Link className="primary-button inline-link" to={`/projects/${project.id}/apis/new`}>Register API</Link>
          <button className="secondary-button" onClick={() => setEditing((current) => !current)}>{editing ? 'Cancel edit' : 'Edit project'}</button>
          <button className="danger-button" disabled={deleting} onClick={() => void deleteProject()}>{deleting ? 'Deleting…' : 'Delete project'}</button>
        </div>
      </header>

      {error && <p className="auth-error" role="alert">{error}</p>}
      {editing ? (
        <form className="panel management-form" onSubmit={(event) => void save(event)}>
          <h2>Edit project</h2>
          <label htmlFor="edit-project-name">Name</label>
          <input id="edit-project-name" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} required />
          <label htmlFor="edit-project-slug">Slug</label>
          <input id="edit-project-slug" value={slug} maxLength={100} onChange={(event) => setSlug(event.target.value)} required />
          <label htmlFor="edit-project-description">Description</label>
          <textarea id="edit-project-description" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
          {formError && <p className="auth-error" role="alert">{formError}</p>}
          <button className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save project'}</button>
        </form>
      ) : (
        <section className="panel detail-panel">
          <h2>Project details</h2>
          <p>{project.description || 'No description provided.'}</p>
          <dl className="detail-list">
            <div><dt>Slug</dt><dd>{project.slug}</dd></div>
            <div><dt>Created</dt><dd><time dateTime={project.createdAt}>{new Date(project.createdAt).toLocaleString()}</time></dd></div>
            <div><dt>Updated</dt><dd><time dateTime={project.updatedAt}>{new Date(project.updatedAt).toLocaleString()}</time></dd></div>
          </dl>
        </section>
      )}

      <section className="management-section">
        <header className="section-header"><div><p className="eyebrow">Project APIs</p><h2>Registered APIs</h2></div><Link className="text-link" to={`/projects/${project.id}/apis`}>View all APIs</Link></header>
        {apis.length ? (
          <div className="management-grid">
            {apis.map((api) => (
              <article className="panel resource-card" key={api.id}>
                <div className="resource-card-heading"><h3><Link to={`/apis/${api.id}`}>{api.name}</Link></h3><span className={`status-badge lifecycle-${api.status.toLowerCase()}`}>{api.status}</span></div>
                <p>{api.description || 'No description provided.'}</p>
                <p className="resource-url">{api.upstreamUrl}{api.upstreamBasePath ?? ''}</p>
                <Link className="text-link" to={`/apis/${api.id}`}>API details</Link>
              </article>
            ))}
          </div>
        ) : (
          <div className="panel empty-panel compact-empty"><h3>No APIs in this project yet</h3><p>Register an API to configure its upstream and gateway access.</p><Link className="primary-button inline-link" to={`/projects/${project.id}/apis/new`}>Register API</Link></div>
        )}
      </section>
    </div>
  );
}
