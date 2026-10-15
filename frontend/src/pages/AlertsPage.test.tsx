import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import type { Alert, AlertEvent } from '../features/alerts/types';
import { AlertsPage } from './AlertsPage';

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
  status: 'ACTIVE',
  authRequired: false,
  version: 1,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  deletedAt: null,
};

const alert: Alert = {
  id: 'alert-1',
  apiId: api.id,
  name: 'Elevated error rate',
  type: 'ERROR_RATE',
  configuration: { threshold: 0.05, windowSeconds: 300 },
  enabled: true,
  runtimeState: 'TRIGGERED',
  triggeredAt: '2025-01-02T00:00:00.000Z',
  recoveredAt: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-02T00:00:00.000Z',
  deletedAt: null,
};

function queueResponses(responses: Response[]): void {
  responses.forEach((response) => mockFetch.mockResolvedValueOnce(response));
}

function inventoryResponses(): Response[] {
  return [jsonResponse({ data: [project] }), jsonResponse({ data: [api] })];
}

function renderAlertsPage(): void {
  render(<MemoryRouter><AlertsPage /></MemoryRouter>);
}

describe('alerts UI', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('creates a validated alert and displays trigger and recovery history', async () => {
    const user = userEvent.setup();
    const events: AlertEvent[] = [
      {
        id: 'event-2',
        alertId: alert.id,
        eventType: 'RECOVERED',
        message: 'Alert condition recovered.',
        metadata: { type: 'ERROR_RATE' },
        occurredAt: '2025-01-03T00:00:00.000Z',
      },
      {
        id: 'event-1',
        alertId: alert.id,
        eventType: 'TRIGGERED',
        message: 'Alert condition became active.',
        metadata: { type: 'ERROR_RATE' },
        occurredAt: '2025-01-02T00:00:00.000Z',
      },
    ];
    queueResponses([
      ...inventoryResponses(),
      jsonResponse({ data: [] }),
      jsonResponse({ data: alert }, 201),
      jsonResponse({ data: [alert] }),
      jsonResponse({ data: events, pagination: { page: 1, limit: 10, total: 2, totalPages: 1 } }),
    ]);
    renderAlertsPage();

    await user.click(await screen.findByRole('button', { name: 'Create alert' }));
    const form = screen.getByRole('form', { name: 'Create alert' });
    await user.type(within(form).getByLabelText('Name'), 'Elevated error rate');
    await user.selectOptions(within(form).getByLabelText('Alert type'), 'ERROR_RATE');
    await user.type(within(form).getByLabelText('Error rate threshold (0–1)'), '0.05');
    await user.type(within(form).getByLabelText('Window (seconds)'), '300');
    await user.click(within(form).getByRole('button', { name: 'Create alert' }));

    expect(await screen.findByRole('heading', { name: 'Elevated error rate' })).toBeInTheDocument();
    expect(screen.getByText('TRIGGERED')).toBeInTheDocument();
    const createCall = mockFetch.mock.calls.find(([url, init]) =>
      url === '/api/v1/apis/api-1/alerts' && (init as RequestInit).method === 'POST',
    );
    expect(createCall).toBeDefined();
    expect(JSON.parse((createCall?.[1] as RequestInit).body as string)).toEqual({
      name: 'Elevated error rate',
      type: 'ERROR_RATE',
      configuration: { threshold: 0.05, windowSeconds: 300 },
    });

    await user.click(screen.getByRole('button', { name: 'Event history' }));
    expect(await screen.findByText('Triggered')).toBeInTheDocument();
    expect(screen.getByText('Recovered')).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith(`/api/v1/alerts/${alert.id}/events?page=1&limit=10`, expect.any(Object));
  });

  it('rejects alert values outside backend bounds without sending a request', async () => {
    const user = userEvent.setup();
    queueResponses([...inventoryResponses(), jsonResponse({ data: [] })]);
    renderAlertsPage();
    await user.click(await screen.findByRole('button', { name: 'Create alert' }));
    const form = screen.getByRole('form', { name: 'Create alert' });
    await user.type(within(form).getByLabelText('Name'), 'Invalid threshold');
    await user.selectOptions(within(form).getByLabelText('Alert type'), 'ERROR_RATE');
    await user.type(within(form).getByLabelText('Error rate threshold (0–1)'), '0');
    await user.type(within(form).getByLabelText('Window (seconds)'), '300');
    await user.click(within(form).getByRole('button', { name: 'Create alert' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/threshold must be greater than 0 and at most 1/i);
    expect(within(form).getByLabelText('Error rate threshold (0–1)')).toHaveValue(0);
    expect(within(form).getByLabelText('Name')).toHaveValue('Invalid threshold');
    expect(mockFetch.mock.calls.filter(([url, init]) =>
      url === '/api/v1/apis/api-1/alerts' && (init as RequestInit).method === 'POST',
    )).toHaveLength(0);
  });

  it('retains alert values and displays a backend validation error', async () => {
    const user = userEvent.setup();
    queueResponses([
      ...inventoryResponses(),
      jsonResponse({ data: [] }),
      jsonResponse({ error: { code: 'INVALID_ALERT_CONFIG', message: 'The alert configuration is invalid.' } }, 400),
    ]);
    renderAlertsPage();
    await user.click(await screen.findByRole('button', { name: 'Create alert' }));
    const form = screen.getByRole('form', { name: 'Create alert' });
    await user.type(within(form).getByLabelText('Name'), 'Rate monitor');
    await user.selectOptions(within(form).getByLabelText('Alert type'), 'ERROR_RATE');
    await user.type(within(form).getByLabelText('Error rate threshold (0–1)'), '0.05');
    await user.type(within(form).getByLabelText('Window (seconds)'), '300');
    await user.click(within(form).getByRole('button', { name: 'Create alert' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The alert configuration is invalid.');
    expect(within(form).getByLabelText('Name')).toHaveValue('Rate monitor');
    expect(within(form).getByLabelText('Error rate threshold (0–1)')).toHaveValue(0.05);
  });

  it('keeps lifecycle enablement separate from a triggered runtime state during manual evaluation', async () => {
    const user = userEvent.setup();
    const disabledAlert: Alert = { ...alert, enabled: false };
    const evaluation = {
      alertId: alert.id,
      apiId: api.id,
      type: alert.type,
      active: true,
      evaluatedAt: '2025-01-04T00:00:00.000Z',
      reason: 'The condition remains active.',
      runtimeState: 'TRIGGERED' as const,
      transitioned: false,
    };
    queueResponses([
      ...inventoryResponses(),
      jsonResponse({ data: [disabledAlert] }),
      jsonResponse({ data: { ...disabledAlert, enabled: true } }),
      jsonResponse({ data: [{ ...disabledAlert, enabled: true }] }),
      jsonResponse({ data: evaluation }),
      jsonResponse({ data: [{ ...alert, enabled: true }] }),
    ]);
    renderAlertsPage();

    expect(await screen.findByText('TRIGGERED')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Enable' }));
    expect(await screen.findByText('Enabled')).toBeInTheDocument();
    expect(screen.getByText('TRIGGERED')).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith(`/api/v1/alerts/${alert.id}/enable`, expect.objectContaining({ method: 'POST' }));
    await user.click(screen.getByRole('button', { name: 'Evaluate now' }));
    expect(await screen.findByText(/Condition is active; runtime state TRIGGERED/i)).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith(`/api/v1/alerts/${alert.id}/evaluate`, expect.objectContaining({ method: 'POST' }));
  });

  it('disables and soft-deletes an alert through its lifecycle endpoints', async () => {
    const user = userEvent.setup();
    const disabledAlert: Alert = { ...alert, enabled: false };
    queueResponses([
      ...inventoryResponses(),
      jsonResponse({ data: [alert] }),
      jsonResponse({ data: disabledAlert }),
      jsonResponse({ data: [disabledAlert] }),
      jsonResponse(null, 204),
      jsonResponse({ data: [] }),
    ]);
    renderAlertsPage();

    await screen.findByRole('heading', { name: 'Elevated error rate' });
    await user.click(screen.getByRole('button', { name: 'Disable' }));
    expect(await screen.findByRole('button', { name: 'Enable' })).toBeInTheDocument();
    const confirmDelete = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(confirmDelete).toHaveBeenCalledWith('Delete the alert "Elevated error rate"?');
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(`/api/v1/alerts/${alert.id}`, expect.objectContaining({ method: 'DELETE' })));
    expect(await screen.findByRole('heading', { name: 'No alerts for this API' })).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith(`/api/v1/alerts/${alert.id}/disable`, expect.objectContaining({ method: 'POST' }));
    expect(mockFetch).toHaveBeenCalledWith(`/api/v1/alerts/${alert.id}`, expect.objectContaining({ method: 'DELETE' }));
  });

  it('edits the complete configuration for a different alert type', async () => {
    const user = userEvent.setup();
    const downAlert: Alert = {
      ...alert,
      name: 'API unavailable',
      type: 'API_DOWN',
      configuration: {},
    };
    const updatedAlert: Alert = {
      ...downAlert,
      type: 'LATENCY',
      configuration: { thresholdMs: 1200, windowSeconds: 600 },
    };
    queueResponses([
      ...inventoryResponses(),
      jsonResponse({ data: [downAlert] }),
      jsonResponse({ data: updatedAlert }),
      jsonResponse({ data: [updatedAlert] }),
    ]);
    renderAlertsPage();

    await screen.findByRole('heading', { name: 'API unavailable' });
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('form', { name: 'Edit alert' });
    await user.selectOptions(within(form).getByLabelText('Alert type'), 'LATENCY');
    await user.type(within(form).getByLabelText('Average latency threshold (ms)'), '1200');
    await user.type(within(form).getByLabelText('Window (seconds)'), '600');
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText(/average latency above .* ms over 600 seconds/i)).toBeInTheDocument();
    const updateCall = mockFetch.mock.calls.find(([url, init]) =>
      url === `/api/v1/alerts/${downAlert.id}` && (init as RequestInit).method === 'PATCH',
    );
    expect(updateCall).toBeDefined();
    expect(JSON.parse((updateCall?.[1] as RequestInit).body as string)).toEqual({
      name: 'API unavailable',
      type: 'LATENCY',
      configuration: { thresholdMs: 1200, windowSeconds: 600 },
    });
  });

  it('renders an honest no-alerts state for an API without configurations', async () => {
    queueResponses([...inventoryResponses(), jsonResponse({ data: [] })]);
    renderAlertsPage();
    expect(await screen.findByRole('heading', { name: 'No alerts for this API' })).toBeInTheDocument();
  });
});
