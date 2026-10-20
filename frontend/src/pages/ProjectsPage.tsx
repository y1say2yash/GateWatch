import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { ApiError, apiRequest } from '../lib/api';
import type { Project } from '../types/management';

const slugFromName = (name: string): string =>
  name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function ProjectsPage(): ReactElement {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [searchParams] = useSearchParams();
  const [showCreateForm, setShowCreateForm] = useState(searchParams.get('create') === '1');
  const [formError, setFormError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState('');
  const navigate = useNavigate();
  const loadSequence = useRef(0);

  const loadProjects = useCallback(async (): Promise<void> => {
    const requestId = ++loadSequence.current;
    setLoading(true);
    setError(null);
    try {
      const loadedProjects = await apiRequest<Project[]>('/api/v1/projects');
      if (requestId === loadSequence.current) setProjects(loadedProjects);
    } catch (err) {
      if (requestId === loadSequence.current) {
        setProjects(null);
        setError(err instanceof ApiError ? err.message : 'Unable to load projects. Please try again.');
      }
    } finally {
      if (requestId === loadSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadProjects();
    });
    return () => {
      active = false;
      loadSequence.current += 1;
    };
  }, [loadProjects]);

  const createProject = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setFormError(null);
    if (!name.trim()) {
      setFormError('Enter a project name.');
      return;
    }
    if (!slug.trim() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.trim().toLowerCase())) {
      setFormError('Slug must use lowercase letters and numbers separated by single hyphens.');
      return;
    }

    setCreating(true);
    try {
      const project = await apiRequest<Project>('/api/v1/projects', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), slug: slug.trim().toLowerCase(), description: description.trim() || null }),
      });
      navigate(`/projects/${project.id}`);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Unable to create this project. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="page-container">
      <header className="page-header">
        <div><p className="eyebrow">Workspace</p><h1>Projects</h1></div>
        <button
          className={showCreateForm ? 'secondary-button' : 'primary-button'}
          type="button"
          onClick={() => setShowCreateForm((visible) => !visible)}
          aria-expanded={showCreateForm}
          aria-controls={showCreateForm ? 'create-project' : undefined}
        >
          {showCreateForm ? 'Cancel' : 'Create project'}
        </button>
      </header>

      {showCreateForm ? (
        <CreateProjectForm
          name={name}
          slug={slug}
          description={description}
          creating={creating}
          error={formError}
          setName={(value) => {
            setName(value);
            if (!slugEdited) setSlug(slugFromName(value));
          }}
          setSlug={(value) => { setSlug(value); setSlugEdited(true); }}
          setDescription={setDescription}
          onSubmit={createProject}
        />
      ) : loading ? (
        <div className="panel state-panel" role="status"><span className="loader" />Loading projects…</div>
      ) : error ? (
        <div className="panel state-panel" role="alert">
          <p>{error}</p><button className="secondary-button" onClick={() => void loadProjects()}>Retry</button>
        </div>
      ) : projects?.length ? (
        <section className="management-grid" aria-label="Projects">
          {projects.map((project) => (
            <article className="panel resource-card" key={project.id}>
              <p className="eyebrow">{project.slug}</p>
              <h2><Link to={`/projects/${project.id}`}>{project.name}</Link></h2>
              <p>{project.description || 'No description provided.'}</p>
              <div className="resource-card-footer">
                <time dateTime={project.createdAt}>Created {new Date(project.createdAt).toLocaleDateString()}</time>
                <Link className="text-link" to={`/projects/${project.id}`}>Open project</Link>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <div className="panel empty-panel">
          <div className="empty-mark" aria-hidden="true">P</div>
          <h2>No projects yet</h2>
          <p>Projects group independently configured APIs. Use Create project to begin.</p>
        </div>
      )}
    </div>
  );
}

interface CreateProjectFormProps {
  name: string;
  slug: string;
  description: string;
  creating: boolean;
  error: string | null;
  setName: (value: string) => void;
  setSlug: (value: string) => void;
  setDescription: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

function CreateProjectForm(props: CreateProjectFormProps): ReactElement {
  return (
    <form id="create-project" className="panel management-form project-create-form" onSubmit={props.onSubmit}>
      <h2>Create project</h2>
      <label htmlFor="project-name">Name</label>
      <input id="project-name" value={props.name} maxLength={100} onChange={(event) => props.setName(event.target.value)} required />
      <label htmlFor="project-slug">Slug</label>
      <input id="project-slug" value={props.slug} maxLength={100} onChange={(event) => props.setSlug(event.target.value)} required aria-describedby="project-slug-help" />
      <small id="project-slug-help">Lowercase letters, numbers, and single hyphens.</small>
      <label htmlFor="project-description">Description <span className="field-optional">(optional)</span></label>
      <textarea id="project-description" rows={3} value={props.description} onChange={(event) => props.setDescription(event.target.value)} />
      {props.error && <p className="auth-error" role="alert">{props.error}</p>}
      <button className="primary-button" type="submit" disabled={props.creating}>
        {props.creating ? 'Creating…' : 'Create project'}
      </button>
    </form>
  );
}
