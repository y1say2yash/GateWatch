import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { DashboardPage } from './DashboardPage';

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
  upstreamUrl: 'https://private-upstream.example.test',
  upstreamBasePath: null,
  status: 'ACTIVE',
  authRequired: true,
  version: 1,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  deletedAt: null,
};

describe('dashboard overview', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('offers project onboarding when the account has no projects', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: [] }));

    render(<MemoryRouter><DashboardPage /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Your APIs deserve a watch.' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create a project' })).toHaveAttribute('href', '/projects?create=1');
  });

  it('shows real API health, request aggregates, and recent request history', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ data: [project] }))
      .mockResolvedValueOnce(jsonResponse({ data: [api] }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          apiId: api.id,
          healthStatus: 'DEGRADED',
          lastHealthCheckAt: '2025-01-04T00:00:00.000Z',
          latestCheck: { status: 'DEGRADED', checkedAt: '2025-01-04T00:00:00.000Z', responseTimeMs: 1200 },
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          apiId: api.id,
          period: { from: '2025-01-03T00:00:00.000Z', to: '2025-01-04T00:00:00.000Z' },
          totalRequests: 12,
          statusCodeCounts: { '200': 10, '500': 2 },
          averageLatencyMs: 20,
          errorCount: 2,
          errorRate: 2 / 12,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [{
          requestId: 'request-1',
          apiId: api.id,
          routeId: null,
          method: 'GET',
          path: '/items',
          statusCode: 200,
          latencyMs: 20,
          clientIdentity: null,
          timestamp: '2025-01-04T00:00:00.000Z',
          result: null,
        }],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      }));

    render(<MemoryRouter><DashboardPage /></MemoryRouter>);

    expect(await screen.findByText('12', { selector: 'p.metric-value' })).toBeInTheDocument();
    expect(screen.getByText('DEGRADED')).toBeInTheDocument();
    expect(screen.getByText('GET', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('/items')).toBeInTheDocument();
    expect(screen.getByText(/Latest recorded latency:/)).toHaveTextContent(/Latest recorded latency:\s*1200 ms/);
    const quickActions = screen.getByRole('heading', { name: 'Quick actions' }).closest('section');
    const metricGrid = document.querySelector('.dashboard-metrics.metric-grid');
    if (!quickActions || !metricGrid) throw new Error('The quick actions section or dashboard metrics grid is missing.');
    expect(quickActions.compareDocumentPosition(metricGrid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('img', { name: /HTTP response classes · last 24 hours/ })).toBeInTheDocument();
    const responseClassTable = screen.getByRole('table', { name: 'HTTP response classes · last 24 hours' });
    expect(within(responseClassTable).getByRole('row', { name: '2xx successful 10' })).toBeInTheDocument();
    expect(within(responseClassTable).getByRole('row', { name: '5xx server errors 2' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Register API' })).toHaveAttribute('href', '/projects/project-1/apis/new');
    expect(screen.getByRole('link', { name: 'Manage tests' })).toHaveAttribute('href', '/testing');
    const summaryUrl = mockFetch.mock.calls.map(([url]) => String(url)).find((url) => url.includes('/monitoring/summary?'));
    expect(summaryUrl).toContain('from=');
    expect(summaryUrl).toContain('to=');
    expect(screen.queryByText('https://private-upstream.example.test')).not.toBeInTheDocument();
  });

  it('shows a retryable error when dashboard data cannot be loaded', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({
        error: { code: 'PROJECTS_UNAVAILABLE', message: 'Project data is temporarily unavailable.' },
      }, 503))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));

    render(<MemoryRouter><DashboardPage /></MemoryRouter>);

    expect(await screen.findByRole('alert')).toHaveTextContent('Project data is temporarily unavailable.');
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Your APIs deserve a watch.' })).toBeInTheDocument();
  });
});
