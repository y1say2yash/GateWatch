import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactElement } from 'react';

import { ApiDetailPage } from './ApiDetailPage';
import { CreateApiPage } from './CreateApiPage';
import { ProjectDetailPage } from './ProjectDetailPage';
import { ProjectApisPage } from './ProjectApisPage';
import { ProjectsPage } from './ProjectsPage';

const mockFetch = vi.fn();

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: vi.fn().mockResolvedValue(body),
  }) as unknown as Response;

const project = {
  id: 'project-1',
  userId: 'user-1',
  name: 'Inventory',
  slug: 'inventory',
  description: null,
  status: 'ACTIVE',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  deletedAt: null,
};

const api = {
  id: 'api-1',
  projectId: project.id,
  name: 'Catalog',
  description: null,
  upstreamUrl: 'https://catalog.example.test',
  upstreamBasePath: null,
  status: 'REGISTERED',
  authRequired: false,
  version: 1,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  deletedAt: null,
};

function apiDetailResponses(apiRecord = api, maxRequests = 100): Response[] {
  return [
    jsonResponse({ data: apiRecord }),
    jsonResponse({ data: project }),
    jsonResponse({ data: [] }),
    jsonResponse({ data: { apiId: api.id, enabled: true, maxRequests, windowSeconds: 60 } }),
    jsonResponse({ data: { apiId: api.id, enabled: false, path: '/', intervalSeconds: 60, timeoutMs: 1000, expectedStatusMin: 200, expectedStatusMax: 299, latencyThresholdMs: 1000 } }),
    jsonResponse({ data: { apiId: api.id, healthStatus: 'DOWN', lastHealthCheckAt: null, latestCheck: null } }),
    jsonResponse({ data: [] }),
  ];
}

function queueResponses(responses: Response[]): void {
  for (const response of responses) mockFetch.mockResolvedValueOnce(response);
}

function submitForm(buttonName: string): Event {
  const form = screen.getByRole('button', { name: buttonName }).closest('form');
  if (!form) throw new Error(`Could not find form for submit button "${buttonName}".`);
  const event = createEvent.submit(form);
  fireEvent(form, event);
  return event;
}

function LocationProbe(): ReactElement {
  const location = useLocation();
  return <output aria-label="Current location">{location.pathname}</output>;
}

function renderRoute(
  path: string,
  element: ReactElement,
  options: { projectDetail?: boolean; apiDetail?: boolean } = {},
): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/projects" element={<ProjectsPage />} />
        {options.projectDetail !== false && <Route path="/projects/:projectId" element={<ProjectDetailPage />} />}
        <Route path="/projects/:projectId/apis" element={<ProjectApisPage />} />
        <Route path="/projects/:projectId/apis/new" element={<CreateApiPage />} />
        {options.apiDetail !== false && <Route path="/apis/:apiId" element={<ApiDetailPage />} />}
        <Route path="*" element={element} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('project and API management', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('lists projects returned by the backend', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: [project] }));
    renderRoute('/projects', <LocationProbe />);

    expect(await screen.findByRole('link', { name: 'Inventory' })).toHaveAttribute(
      'href',
      '/projects/project-1',
    );
    expect(screen.getByText('inventory')).toBeInTheDocument();
  });

  it('shows an honest empty state when there are no projects', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: [] }));
    renderRoute('/projects', <LocationProbe />);

    expect(await screen.findByRole('heading', { name: 'Create your first project' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
  });

  it('shows a recoverable error when the project list request fails', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({
      error: { code: 'PROJECT_LIST_FAILED', message: 'Unable to list projects.' },
    }, 500));
    renderRoute('/projects', <LocationProbe />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to list projects.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('validates project slugs before submitting', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: [] }));
    renderRoute('/projects', <LocationProbe />);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Name'), 'Inventory');
    await user.clear(screen.getByLabelText('Slug'));
    await user.type(screen.getByLabelText('Slug'), 'not a valid slug');
    expect(submitForm('Create project').defaultPrevented).toBe(true);

    expect(await screen.findByRole('alert')).toHaveTextContent('Slug must use lowercase letters');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('creates a project using the backend response and navigates to it', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({ data: project }, 201));
    renderRoute('/projects', <LocationProbe />, { projectDetail: false });
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Name'), project.name);
    expect(screen.getByLabelText('Slug')).toHaveValue(project.slug);
    expect(submitForm('Create project').defaultPrevented).toBe(true);

    expect(await screen.findByLabelText('Current location')).toHaveTextContent('/projects/project-1');
    expect(mockFetch).toHaveBeenLastCalledWith(
      '/api/v1/projects',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Inventory', slug: 'inventory', description: null }),
      }),
    );
  });

  it('prevents duplicate project creation while the request is pending', async () => {
    let finishCreate: (response: Response) => void = () => undefined;
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishCreate = resolve; }));
    renderRoute('/projects', <LocationProbe />, { projectDetail: false });
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Name'), project.name);
    expect(submitForm('Create project').defaultPrevented).toBe(true);
    const pendingButton = await screen.findByRole('button', { name: 'Creating…' });
    await user.click(pendingButton);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    finishCreate(jsonResponse({ data: project }, 201));
    expect(await screen.findByLabelText('Current location')).toHaveTextContent('/projects/project-1');
  });

  it('updates a project through its project-scoped endpoint', async () => {
    const updatedProject = { ...project, name: 'Inventory Platform' };
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ data: project }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({ data: updatedProject }));
    renderRoute(`/projects/${project.id}`, <LocationProbe />);
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Inventory' });
    await user.click(screen.getByRole('button', { name: 'Edit project' }));
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), updatedProject.name);
    expect(submitForm('Save project').defaultPrevented).toBe(true);

    expect(await screen.findByRole('heading', { name: updatedProject.name })).toBeInTheDocument();
    expect(mockFetch).toHaveBeenLastCalledWith(
      `/api/v1/projects/${project.id}`,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ name: updatedProject.name, slug: project.slug, description: null }),
      }),
    );
  });

  it('shows the backend not-found state for an unavailable project', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } }, 404))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } }, 404));
    renderRoute('/projects/missing', <LocationProbe />);

    expect(await screen.findByRole('heading', { name: 'Project unavailable' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('not found or is no longer available');
  });

  it('lists project APIs and shows health only when reported by the backend', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ data: project }))
      .mockResolvedValueOnce(jsonResponse({ data: [api] }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          apiId: api.id,
          healthStatus: 'HEALTHY',
          lastHealthCheckAt: null,
          latestCheck: null,
        },
      }));
    renderRoute(`/projects/${project.id}/apis`, <LocationProbe />);

    expect(await screen.findByRole('link', { name: 'Manage' })).toHaveAttribute('href', '/apis/api-1');
    expect(screen.getByText('HEALTHY')).toBeInTheDocument();
    expect(screen.getByText('REGISTERED')).toBeInTheDocument();
  });

  it('shows an empty API list for a project with no registered APIs', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ data: project }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));
    renderRoute(`/projects/${project.id}/apis`, <LocationProbe />);

    expect(await screen.findByRole('heading', { name: 'No APIs in Inventory' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Register API' })).toHaveLength(2);
    for (const link of screen.getAllByRole('link', { name: 'Register API' })) {
      expect(link).toHaveAttribute('href', `/projects/${project.id}/apis/new`);
    }
  });

  it('does not present APIs when the project request fails', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({
        error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' },
      }, 404))
      .mockResolvedValueOnce(jsonResponse({
        error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' },
      }, 404));
    renderRoute('/projects/missing/apis', <LocationProbe />);

    expect(await screen.findByRole('heading', { name: 'Project APIs unavailable' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('not found or is no longer available');
    expect(screen.getByRole('link', { name: 'Back to projects' })).toHaveAttribute('href', '/projects');
  });

  it('registers an API and each selected route method using separate backend requests', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ data: project }))
      .mockResolvedValueOnce(jsonResponse({ data: api }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'route-get' } }, 201))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'route-post' } }, 201));
    renderRoute(`/projects/${project.id}/apis/new`, <LocationProbe />, { apiDetail: false });
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Register API' });
    await user.type(screen.getByLabelText('API name'), 'Catalog');
    await user.type(screen.getByLabelText('Base upstream URL'), api.upstreamUrl);
    await user.type(screen.getByLabelText('Public route prefix'), '/catalog');
    await user.click(screen.getByRole('checkbox', { name: 'POST' }));
    expect(submitForm('Register API').defaultPrevented).toBe(true);

    expect(await screen.findByLabelText('Current location')).toHaveTextContent('/apis/api-1');
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      `/api/v1/projects/${project.id}/apis`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'Catalog',
          description: null,
          upstreamUrl: api.upstreamUrl,
          upstreamBasePath: null,
        }),
      }),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      3,
      '/api/v1/apis/api-1/routes',
      expect.objectContaining({ body: JSON.stringify({ pathPrefix: '/catalog', method: 'GET' }) }),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      4,
      '/api/v1/apis/api-1/routes',
      expect.objectContaining({ body: JSON.stringify({ pathPrefix: '/catalog', method: 'POST' }) }),
    );
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('submits API registration only once while the request is pending', async () => {
    let finishCreate: (response: Response) => void = () => undefined;
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ data: project }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishCreate = resolve; }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'route-get' } }, 201));
    renderRoute(`/projects/${project.id}/apis/new`, <LocationProbe />, { apiDetail: false });
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Register API' });
    await user.type(screen.getByLabelText('API name'), 'Catalog');
    await user.type(screen.getByLabelText('Base upstream URL'), api.upstreamUrl);
    await user.type(screen.getByLabelText('Public route prefix'), '/catalog');
    const form = screen.getByRole('button', { name: 'Register API' }).closest('form');
    if (!form) throw new Error('Could not find API registration form.');

    const firstSubmit = createEvent.submit(form);
    fireEvent(form, firstSubmit);
    const secondSubmit = createEvent.submit(form);
    fireEvent(form, secondSubmit);

    expect(firstSubmit.defaultPrevented).toBe(true);
    expect(secondSubmit.defaultPrevented).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    finishCreate(jsonResponse({ data: api }, 201));
    expect(await screen.findByLabelText('Current location')).toHaveTextContent('/apis/api-1');
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('preserves API form values and reports a backend validation failure', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ data: project }))
      .mockResolvedValueOnce(jsonResponse({
        error: { code: 'API_NAME_CONFLICT', message: 'An API with this name already exists.' },
      }, 409));
    renderRoute(`/projects/${project.id}/apis/new`, <LocationProbe />, { apiDetail: false });
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Register API' });
    await user.type(screen.getByLabelText('API name'), 'Catalog');
    await user.type(screen.getByLabelText('Base upstream URL'), api.upstreamUrl);
    await user.type(screen.getByLabelText('Public route prefix'), '/catalog');
    expect(submitForm('Register API').defaultPrevented).toBe(true);

    expect(await screen.findByRole('alert')).toHaveTextContent('An API with this name already exists.');
    expect(screen.getByLabelText('API name')).toHaveValue('Catalog');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('warns when API creation succeeds but gateway route setup fails', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ data: project }))
      .mockResolvedValueOnce(jsonResponse({ data: api }, 201))
      .mockResolvedValueOnce(jsonResponse({
        error: { code: 'ROUTE_CONFLICT', message: 'Route already exists.' },
      }, 409))
      .mockResolvedValueOnce(jsonResponse({ data: api }))
      .mockResolvedValueOnce(jsonResponse({ data: project }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({ data: { apiId: api.id, enabled: true, maxRequests: 100, windowSeconds: 60 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { apiId: api.id, enabled: false, path: '/', intervalSeconds: 60, timeoutMs: 1000, expectedStatusMin: 200, expectedStatusMax: 299, latencyThresholdMs: 1000 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { apiId: api.id, healthStatus: 'DOWN', lastHealthCheckAt: null, latestCheck: null } }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));
    renderRoute(`/projects/${project.id}/apis/new`, <LocationProbe />);
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Register API' });
    await user.type(screen.getByLabelText('API name'), 'Catalog');
    await user.type(screen.getByLabelText('Base upstream URL'), api.upstreamUrl);
    await user.type(screen.getByLabelText('Public route prefix'), '/catalog');
    expect(submitForm('Register API').defaultPrevented).toBe(true);

    expect(await screen.findByRole('heading', { name: 'Catalog' })).toBeInTheDocument();
    expect(mockFetch).toHaveBeenNthCalledWith(
      3,
      '/api/v1/apis/api-1/routes',
      expect.objectContaining({ body: JSON.stringify({ pathPrefix: '/catalog', method: 'GET' }) }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The API was registered, but some gateway configuration could not be saved: Route already exists.',
    );
  });

  it('reports API loading failures using the backend error response', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({
      error: { code: 'API_NOT_FOUND', message: 'API not found.' },
    }, 404));
    renderRoute('/apis/missing', <LocationProbe />);

    expect(await screen.findByRole('heading', { name: 'API unavailable' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('not found or is no longer available');
  });

  it('updates API lifecycle only after the backend confirms the change', async () => {
    const activeApi = { ...api, status: 'ACTIVE' };
    const disabledApi = { ...api, status: 'DISABLED' };
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ data: activeApi }))
      .mockResolvedValueOnce(jsonResponse({ data: project }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({ data: { apiId: api.id, enabled: true, maxRequests: 100, windowSeconds: 60 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { apiId: api.id, enabled: false, path: '/', intervalSeconds: 60, timeoutMs: 1000, expectedStatusMin: 200, expectedStatusMax: 299, latencyThresholdMs: 1000 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { apiId: api.id, healthStatus: 'DOWN', lastHealthCheckAt: null, latestCheck: null } }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({ data: disabledApi }))
      .mockResolvedValueOnce(jsonResponse({ data: disabledApi }))
      .mockResolvedValueOnce(jsonResponse({ data: project }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({ data: { apiId: api.id, enabled: true, maxRequests: 100, windowSeconds: 60 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { apiId: api.id, enabled: false, path: '/', intervalSeconds: 60, timeoutMs: 1000, expectedStatusMin: 200, expectedStatusMax: 299, latencyThresholdMs: 1000 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { apiId: api.id, healthStatus: 'DOWN', lastHealthCheckAt: null, latestCheck: null } }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));
    renderRoute('/apis/api-1', <LocationProbe />);
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Catalog' });
    await user.click(screen.getByRole('button', { name: 'Disable API' }));

    expect(await screen.findByText('DISABLED')).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/apis/api-1/disable',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('keeps lifecycle status unchanged and reports a failed lifecycle request', async () => {
    queueResponses(apiDetailResponses({ ...api, status: 'ACTIVE' }));
    mockFetch.mockResolvedValueOnce(jsonResponse({
      error: { code: 'API_OPERATION_FAILED', message: 'Unable to disable API.' },
    }, 500));
    renderRoute('/apis/api-1', <LocationProbe />);
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Catalog' });
    await user.click(screen.getByRole('button', { name: 'Disable API' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to disable API.');
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(8);
  });

  it('reports a route conflict without discarding the entered prefix', async () => {
    queueResponses(apiDetailResponses());
    mockFetch.mockResolvedValueOnce(jsonResponse({
      error: { code: 'ROUTE_CONFLICT', message: 'This route already exists.' },
    }, 409));
    renderRoute('/apis/api-1', <LocationProbe />);
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Catalog' });
    await user.type(screen.getByLabelText('Add route prefix'), '/catalog');
    await user.click(screen.getByRole('button', { name: 'Add route' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This route already exists.');
    expect(screen.getByLabelText('Add route prefix')).toHaveValue('/catalog');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/apis/api-1/routes',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ pathPrefix: '/catalog', method: 'GET' }),
      }),
    );
  });

  it('saves rate-limit configuration to the backend and displays its returned value', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ data: api }))
      .mockResolvedValueOnce(jsonResponse({ data: project }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({ data: { apiId: api.id, enabled: true, maxRequests: 100, windowSeconds: 60 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { apiId: api.id, enabled: false, path: '/', intervalSeconds: 60, timeoutMs: 1000, expectedStatusMin: 200, expectedStatusMax: 299, latencyThresholdMs: 1000 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { apiId: api.id, healthStatus: 'DOWN', lastHealthCheckAt: null, latestCheck: null } }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({ data: { apiId: api.id, enabled: true, maxRequests: 200, windowSeconds: 60 } }))
      .mockResolvedValueOnce(jsonResponse({ data: api }))
      .mockResolvedValueOnce(jsonResponse({ data: project }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({ data: { apiId: api.id, enabled: true, maxRequests: 200, windowSeconds: 60 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { apiId: api.id, enabled: false, path: '/', intervalSeconds: 60, timeoutMs: 1000, expectedStatusMin: 200, expectedStatusMax: 299, latencyThresholdMs: 1000 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { apiId: api.id, healthStatus: 'DOWN', lastHealthCheckAt: null, latestCheck: null } }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));
    renderRoute('/apis/api-1', <LocationProbe />);
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Catalog' });
    await user.clear(screen.getByLabelText('Maximum requests'));
    await user.type(screen.getByLabelText('Maximum requests'), '200');
    expect(submitForm('Save rate limit').defaultPrevented).toBe(true);

    expect(await screen.findByLabelText('Maximum requests')).toHaveValue(200);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/apis/api-1/rate-limit',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ enabled: true, maxRequests: 200, windowSeconds: 60 }),
      }),
    );
  });

  it('keeps a newly issued API key visible if refreshing API details fails', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ data: api }))
      .mockResolvedValueOnce(jsonResponse({ data: project }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({ data: { apiId: api.id, enabled: true, maxRequests: 100, windowSeconds: 60 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { apiId: api.id, enabled: false, path: '/', intervalSeconds: 60, timeoutMs: 1000, expectedStatusMin: 200, expectedStatusMax: 299, latencyThresholdMs: 1000 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { apiId: api.id, healthStatus: 'DOWN', lastHealthCheckAt: null, latestCheck: null } }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({ data: { apiKey: { id: 'key-1', apiId: api.id, name: 'Deployment', keyPrefix: 'gw_test', lastUsedAt: null, createdAt: '2025-01-01T00:00:00.000Z', revokedAt: null }, key: 'gw_secret_once' } }, 201))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'API_OPERATION_FAILED', message: 'Refresh failed.' } }, 500));
    renderRoute('/apis/api-1', <LocationProbe />);
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Catalog' });
    await user.type(screen.getByLabelText('New key name'), 'Deployment');
    expect(submitForm('Create API key').defaultPrevented).toBe(true);

    expect(await screen.findByText('gw_secret_once')).toBeInTheDocument();
    expect(screen.getByText(/Copy the new API key now/)).toBeInTheDocument();
  });
});
