import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { MonitoringPage } from './MonitoringPage';

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
  upstreamBasePath: '/private',
  status: 'ACTIVE',
  authRequired: true,
  version: 1,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  deletedAt: null,
};

const route = {
  id: 'route-1',
  apiId: api.id,
  pathPrefix: '/items',
  method: 'GET',
  isActive: true,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  deletedAt: null,
};

function setupInventory(): void {
  mockFetch
    .mockResolvedValueOnce(jsonResponse({ data: [project] }))
    .mockResolvedValueOnce(jsonResponse({ data: [api] }))
    .mockResolvedValueOnce(jsonResponse({ data: [route] }));
}

function renderMonitoring(): void {
  render(
    <MemoryRouter initialEntries={['/monitoring']}>
      <Routes>
        <Route path="/monitoring" element={<MonitoringPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('monitoring operations UI', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('maps owned routes into gateway paths without exposing upstream configuration', async () => {
    setupInventory();
    renderMonitoring();

    expect(await screen.findByRole('heading', { name: 'Gateway routes' })).toBeInTheDocument();
    expect(screen.getByText('/p/inventory/items')).toBeInTheDocument();
    expect(screen.getByText('GET')).toBeInTheDocument();
    expect(screen.getByText('Required')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Catalog' })).toHaveAttribute('href', '/apis/api-1');
    expect(screen.queryByText('https://private-upstream.example.test')).not.toBeInTheDocument();
    expect(screen.queryByText('/private')).not.toBeInTheDocument();
  });

  it('filters request history on the backend and displays pagination metadata', async () => {
    setupInventory();
    mockFetch
      .mockResolvedValueOnce(jsonResponse({
        data: [{
          requestId: 'request-1',
          apiId: api.id,
          routeId: route.id,
          method: 'GET',
          path: '/items/42',
          statusCode: 502,
          latencyMs: 120,
          clientIdentity: 'ip:127.0.0.1',
          timestamp: '2025-01-02T00:00:00.000Z',
          result: { source: 'gateway', errorCode: 'UPSTREAM_CONNECTION_FAILED' },
        }],
        pagination: { page: 1, limit: 20, total: 21, totalPages: 2 },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [{
          requestId: 'request-2',
          apiId: api.id,
          routeId: route.id,
          method: 'GET',
          path: '/items/43',
          statusCode: 500,
          latencyMs: null,
          clientIdentity: null,
          timestamp: '2025-01-03T00:00:00.000Z',
          result: { source: 'gateway', errorCode: 'UPSTREAM_TIMEOUT' },
        }],
        pagination: { page: 1, limit: 20, total: 21, totalPages: 2 },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [{
          requestId: 'request-3',
          apiId: api.id,
          routeId: route.id,
          method: 'GET',
          path: '/items/44',
          statusCode: 500,
          latencyMs: 85,
          clientIdentity: null,
          timestamp: '2025-01-04T00:00:00.000Z',
          result: { source: 'gateway', errorCode: 'UPSTREAM_TIMEOUT' },
        }],
        pagination: { page: 2, limit: 20, total: 21, totalPages: 2 },
      }));
    renderMonitoring();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('tab', { name: 'Requests' }));
    expect(await screen.findByText('/items/42')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 2 · 21 matching requests')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Method'), 'GET');
    await user.type(screen.getByLabelText('Exact HTTP status'), '500');
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));

    expect(await screen.findByText('/items/43')).toBeInTheDocument();
    const requestUrl = mockFetch.mock.calls
      .map(([url]) => String(url))
      .find((url) => url.includes('/api/v1/apis/api-1/requests?') && url.includes('statusCode=500'));
    expect(requestUrl).toContain('method=GET');
    expect(requestUrl).toContain('statusCode=500');
    expect(screen.queryByText('ip:127.0.0.1')).not.toBeInTheDocument();
    expect(screen.getByText(/UPSTREAM_TIMEOUT/)).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 2 · 21 matching requests')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('/items/44')).toBeInTheDocument();
    const pageTwoUrl = mockFetch.mock.calls
      .map(([url]) => String(url))
      .find((url) => url.includes('/requests?') && url.includes('page=2'));
    expect(pageTwoUrl).toContain('statusCode=500');
  });

  it('shows health independently from lifecycle and renders bounded health history', async () => {
    const disabledApi = { ...api, status: 'DISABLED', authRequired: false };
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ data: [project] }))
      .mockResolvedValueOnce(jsonResponse({ data: [disabledApi] }))
      .mockResolvedValueOnce(jsonResponse({ data: [route] }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          apiId: api.id,
          healthStatus: 'DEGRADED',
          lastHealthCheckAt: '2025-01-04T00:00:00.000Z',
          latestCheck: {
            id: 'check-1',
            apiId: api.id,
            status: 'DEGRADED',
            responseTimeMs: 1250,
            httpStatus: 200,
            attemptCount: 2,
            errorMessage: 'Retry succeeded after an initial failed attempt.',
            isManual: false,
            checkedAt: '2025-01-04T00:00:00.000Z',
          },
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { apiId: api.id, enabled: false, path: '/', intervalSeconds: 60, timeoutMs: 5000, expectedStatusMin: 200, expectedStatusMax: 299, latencyThresholdMs: 1000 },
      }));
    renderMonitoring();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('tab', { name: 'API health' }));
    expect(await screen.findByText('DEGRADED')).toBeInTheDocument();
    expect(screen.getByText('DISABLED')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.getByText('HTTP 200')).toBeInTheDocument();

    mockFetch.mockResolvedValueOnce(jsonResponse({
      data: [{
        id: 'check-1',
        apiId: api.id,
        status: 'DEGRADED',
        responseTimeMs: 1250,
        httpStatus: 200,
        attemptCount: 2,
        errorMessage: 'Retry succeeded after an initial failed attempt.',
        isManual: false,
        checkedAt: '2025-01-04T00:00:00.000Z',
      }],
      pagination: { limit: 100 },
    }));
    await user.click(screen.getByRole('tab', { name: 'Health history' }));
    expect(await screen.findByText('Retry succeeded after an initial failed attempt.')).toBeInTheDocument();
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
  });

  it('renders all documented health states without conflating API lifecycle', async () => {
    const healthApis = [
      { ...api, id: 'api-healthy', name: 'Healthy API', status: 'ACTIVE' },
      { ...api, id: 'api-degraded', name: 'Degraded API', status: 'DISABLED' },
      { ...api, id: 'api-down', name: 'Down API', status: 'REGISTERED' },
    ];
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ data: [project] }))
      .mockResolvedValueOnce(jsonResponse({ data: healthApis }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({
        data: { apiId: 'api-healthy', healthStatus: 'HEALTHY', lastHealthCheckAt: '2025-01-04T00:00:00.000Z', latestCheck: { id: 'check-healthy', apiId: 'api-healthy', status: 'HEALTHY', responseTimeMs: 200, httpStatus: 200, attemptCount: 1, errorMessage: null, isManual: false, checkedAt: '2025-01-04T00:00:00.000Z' } },
      }))
      .mockResolvedValueOnce(jsonResponse({ data: { apiId: 'api-healthy', enabled: true, path: '/', intervalSeconds: 60, timeoutMs: 5000, expectedStatusMin: 200, expectedStatusMax: 299, latencyThresholdMs: 1000 } }))
      .mockResolvedValueOnce(jsonResponse({
        data: { apiId: 'api-degraded', healthStatus: 'DEGRADED', lastHealthCheckAt: '2025-01-04T00:00:00.000Z', latestCheck: { id: 'check-degraded', apiId: 'api-degraded', status: 'DEGRADED', responseTimeMs: 1200, httpStatus: 200, attemptCount: 2, errorMessage: 'Retry succeeded after an initial failed attempt.', isManual: false, checkedAt: '2025-01-04T00:00:00.000Z' } },
      }))
      .mockResolvedValueOnce(jsonResponse({ data: { apiId: 'api-degraded', enabled: false, path: '/', intervalSeconds: 60, timeoutMs: 5000, expectedStatusMin: 200, expectedStatusMax: 299, latencyThresholdMs: 1000 } }))
      .mockResolvedValueOnce(jsonResponse({
        data: { apiId: 'api-down', healthStatus: 'DOWN', lastHealthCheckAt: '2025-01-04T00:00:00.000Z', latestCheck: { id: 'check-down', apiId: 'api-down', status: 'DOWN', responseTimeMs: 1000, httpStatus: null, attemptCount: 2, errorMessage: 'Unable to connect to upstream API.', isManual: true, checkedAt: '2025-01-04T00:00:00.000Z' } },
      }))
      .mockResolvedValueOnce(jsonResponse({ data: { apiId: 'api-down', enabled: true, path: '/', intervalSeconds: 60, timeoutMs: 5000, expectedStatusMin: 200, expectedStatusMax: 299, latencyThresholdMs: 1000 } }));
    renderMonitoring();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('tab', { name: 'API health' }));
    expect(await screen.findByText('HEALTHY')).toBeInTheDocument();
    expect(screen.getByText('DEGRADED')).toBeInTheDocument();
    expect(screen.getByText('DOWN')).toBeInTheDocument();
    expect(screen.getByText('DISABLED')).toBeInTheDocument();
    expect(screen.getByText('REGISTERED')).toBeInTheDocument();
  });

  it('uses the backend aggregate for the selected API and time range', async () => {
    setupInventory();
    mockFetch.mockResolvedValueOnce(jsonResponse({
      data: {
        apiId: api.id,
        period: { from: '2025-01-01T00:00:00.000Z', to: '2025-01-02T00:00:00.000Z' },
        totalRequests: 10,
        statusCodeCounts: { '200': 8, '500': 2 },
        averageLatencyMs: 115,
        errorCount: 2,
        errorRate: 0.2,
      },
    }));
    renderMonitoring();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('tab', { name: 'Metrics' }));
    expect(await screen.findByText('10', { selector: 'strong' })).toBeInTheDocument();
    const errorMetric = screen.getByText('HTTP errors (≥400)').parentElement;
    if (!errorMetric) throw new Error('The HTTP errors metric card is missing.');
    expect(within(errorMetric).getByText('2', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('20%', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('115.0 ms', { selector: 'strong' })).toBeInTheDocument();
    const statusCodeCounts = screen.getByRole('heading', { name: 'Status-code counts' }).closest('section');
    if (!statusCodeCounts) throw new Error('The status-code counts section is missing.');
    expect(within(statusCodeCounts).getByText('2', { selector: 'strong' })).toBeInTheDocument();
    await waitFor(() => {
      const summaryUrl = mockFetch.mock.calls
        .map(([url]) => String(url))
        .find((url) => url.includes('/monitoring/summary?'));
      expect(summaryUrl).toBeDefined();
      const range = new URLSearchParams(summaryUrl?.split('?')[1]);
      expect(new Date(range.get('from') ?? '').getTime()).toBeLessThanOrEqual(
        new Date(range.get('to') ?? '').getTime(),
      );
    });
  });

  it('shows the honest empty inventory state', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: [] }));
    renderMonitoring();

    expect(await screen.findByRole('heading', { name: 'No projects yet' })).toBeInTheDocument();
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
  });

  it('shows a recoverable error when the inventory request fails', async () => {
    mockFetch
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));
    renderMonitoring();
    const user = userEvent.setup();

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to reach the GateWatch server.');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'No projects yet' })).toBeInTheDocument();
  });

  it('recovers from request-history errors and reports an empty result without fake counts', async () => {
    setupInventory();
    mockFetch
      .mockResolvedValueOnce(jsonResponse({
        error: { code: 'REQUEST_HISTORY_FAILED', message: 'Failed to retrieve request history.' },
      }, 500))
      .mockResolvedValueOnce(jsonResponse({
        data: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      }));
    renderMonitoring();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('tab', { name: 'Requests' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to retrieve request history.');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'No matching requests' })).toBeInTheDocument();
    expect(screen.queryByText('0 matching requests')).not.toBeInTheDocument();
  });
});
