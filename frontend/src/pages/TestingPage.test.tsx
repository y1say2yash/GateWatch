import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import type { ApiTestDefinition, TestExecutionResult } from '../features/testing/types';
import App from '../App';
import { TestingPage } from './TestingPage';

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

const testDefinition: ApiTestDefinition = {
  id: 'test-1',
  apiId: api.id,
  name: 'Catalog responds',
  method: 'GET',
  url: 'https://catalog.example.test/items',
  headers: {},
  body: null,
  authentication: { type: 'NONE', credentialConfigured: false },
  assertions: [{ type: 'STATUS_CODE', operator: 'EQUALS', expected: 200 }],
  timeoutMs: 5000,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};

function queueResponses(responses: Response[]): void {
  responses.forEach((response) => mockFetch.mockResolvedValueOnce(response));
}

function inventoryResponses(): Response[] {
  return [jsonResponse({ data: [project] }), jsonResponse({ data: [api] })];
}

function renderTestingPage(): void {
  render(<MemoryRouter><TestingPage /></MemoryRouter>);
}

describe('API testing UI', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows an honest empty state when the selected API has no test definitions', async () => {
    queueResponses([...inventoryResponses(), jsonResponse({ data: [] })]);
    renderTestingPage();

    expect(await screen.findByRole('heading', { name: 'No tests for this API' })).toBeInTheDocument();
    expect(screen.getByLabelText('API')).toHaveValue(api.id);
  });

  it('exposes the testing route through protected application navigation', async () => {
    const user = userEvent.setup();
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ data: {
        id: 'user-1', githubId: 123, githubUsername: 'gatewatch-user', email: 'user@example.com',
        avatarUrl: null, status: 'ACTIVE', isAdmin: false,
      } }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));
    render(<App />);

    await screen.findByRole('heading', { name: 'Dashboard' });
    expect(screen.getByRole('link', { name: 'Testing' })).toHaveAttribute('href', '/testing');
    expect(screen.getByRole('link', { name: 'Alerts' })).toHaveAttribute('href', '/alerts');
    await user.click(screen.getByRole('link', { name: 'Testing' }));
    expect(await screen.findByRole('heading', { name: 'API Testing' })).toBeInTheDocument();
  });

  it('creates a test, executes it, and displays only safe assertion summaries', async () => {
    const user = userEvent.setup();
    const execution: TestExecutionResult = {
      id: 'execution-1',
      executionId: 'execution-1',
      status: 'FAILED',
      passed: false,
      durationMs: 38,
      result: {
        passed: false,
        status: 'FAILED',
        durationMs: 38,
        responseStatus: 500,
        responseTimeMs: 37,
        assertions: [{
          type: 'JSON_BODY',
          pass: false,
          expected: 'private expected value',
          actual: 'private response value',
          path: '/status',
          message: 'Response assertion failed.',
        }],
      },
    };
    queueResponses([
      ...inventoryResponses(),
      jsonResponse({ data: [] }),
      jsonResponse({ data: testDefinition }, 201),
      jsonResponse({ data: [testDefinition] }),
      jsonResponse({ data: execution }),
    ]);
    renderTestingPage();

    await user.click((await screen.findAllByRole('button', { name: 'Create test' }))[0]);
    await user.type(screen.getByLabelText('Name'), 'Catalog responds');
    await user.selectOptions(screen.getByLabelText('Method'), 'GET');
    await user.type(screen.getByLabelText('Test URL'), 'https://catalog.example.test/items');
    fireEvent.change(screen.getByLabelText('Assertions (JSON array)'), {
      target: { value: '[{"type":"STATUS_CODE","operator":"EQUALS","expected":200}]' },
    });
    await user.click(within(screen.getByRole('form', { name: 'Create API test' })).getByRole('button', { name: 'Create test' }));

    expect(await screen.findByRole('heading', { name: 'Catalog responds' })).toBeInTheDocument();
    const createCall = mockFetch.mock.calls.find(([url, init]) =>
      url === '/api/v1/apis/api-1/tests' && (init as RequestInit).method === 'POST',
    );
    expect(createCall).toBeDefined();
    expect(JSON.parse((createCall?.[1] as RequestInit).body as string)).toMatchObject({
      name: 'Catalog responds',
      method: 'GET',
      url: 'https://catalog.example.test/items',
      assertions: [{ type: 'STATUS_CODE', operator: 'EQUALS', expected: 200 }],
      timeoutMs: 5000,
    });

    await user.click(screen.getByRole('button', { name: 'Run test' }));
    expect(await screen.findByRole('heading', { name: 'Latest run: FAILED' })).toBeInTheDocument();
    expect(screen.getByText(/JSON BODY/)).toBeInTheDocument();
    expect(screen.queryByText('private expected value')).not.toBeInTheDocument();
    expect(screen.queryByText('private response value')).not.toBeInTheDocument();
    expect(screen.getByText(/upstream response values and bodies are not displayed/i)).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/tests/test-1/execute', expect.objectContaining({ method: 'POST' }));
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/executions'))).toBe(false);
  });

  it('retains a configured authentication secret as a masked field and does not display it', async () => {
    const user = userEvent.setup();
    const existing = {
      ...testDefinition,
      authentication: { type: 'BEARER' as const, credentialConfigured: true },
    };
    queueResponses([...inventoryResponses(), jsonResponse({ data: [existing] })]);
    renderTestingPage();

    expect(await screen.findByText('Authentication configured (BEARER); credential is hidden.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const secretField = screen.getByLabelText('Bearer token');
    expect(secretField).toHaveAttribute('type', 'password');
    expect(secretField).toHaveValue('');
    expect(screen.getByText(/leave the secret field blank to retain it/i)).toBeInTheDocument();
  });

  it('updates a saved definition and soft-deletes it', async () => {
    const user = userEvent.setup();
    const originalUrl = 'https://catalog.example.test/items?access_token=hidden-value&search=private-value';
    const savedTest = { ...testDefinition, url: originalUrl };
    const updatedTest = { ...savedTest, name: 'Catalog accepts requests' };
    queueResponses([
      ...inventoryResponses(),
      jsonResponse({ data: [savedTest] }),
      jsonResponse({ data: updatedTest }),
      jsonResponse({ data: [updatedTest] }),
      jsonResponse(null, 204),
      jsonResponse({ data: [] }),
    ]);
    renderTestingPage();

    await screen.findByRole('heading', { name: 'Catalog responds' });
    expect(screen.queryByText(/hidden-value|private-value/)).not.toBeInTheDocument();
    expect(screen.getByText(/%5Bhidden%5D/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('form', { name: 'Edit API test' });
    await user.clear(within(form).getByLabelText('Name'));
    await user.type(within(form).getByLabelText('Name'), 'Catalog accepts requests');
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('heading', { name: 'Catalog accepts requests' })).toBeInTheDocument();
    const updateCall = mockFetch.mock.calls.find(([url, init]) =>
      url === '/api/v1/tests/test-1' && (init as RequestInit).method === 'PATCH',
    );
    expect(updateCall).toBeDefined();
    expect(JSON.parse((updateCall?.[1] as RequestInit).body as string).url).toBe(originalUrl);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('heading', { name: 'No tests for this API' })).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/tests/test-1', expect.objectContaining({ method: 'DELETE' }));
    expect(window.confirm).toHaveBeenCalledWith('Delete the test "Catalog accepts requests"?');
  });

  it('prevents duplicate manual executions while a request is pending', async () => {
    const user = userEvent.setup();
    let resolveExecution: ((response: Response) => void) | undefined;
    const pendingResponse = new Promise<Response>((resolve) => { resolveExecution = resolve; });
    queueResponses([...inventoryResponses(), jsonResponse({ data: [testDefinition] }), pendingResponse as unknown as Response]);
    renderTestingPage();

    await user.click(await screen.findByRole('button', { name: 'Run test' }));
    expect(await screen.findByRole('button', { name: 'Running…' })).toBeDisabled();
    expect(mockFetch.mock.calls.filter(([url]) => url === '/api/v1/tests/test-1/execute')).toHaveLength(1);
    resolveExecution?.(jsonResponse({
      data: {
        id: 'execution-1',
        executionId: 'execution-1',
        status: 'PASSED',
        passed: true,
        durationMs: 10,
        result: { passed: true, status: 'PASSED', durationMs: 10, responseStatus: 200, responseTimeMs: 9, assertions: [] },
      },
    }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Latest run: PASSED' })).toBeInTheDocument());
  });

  it('does not submit credential-like URL parameters and preserves form values', async () => {
    const user = userEvent.setup();
    queueResponses([...inventoryResponses(), jsonResponse({ data: [] })]);
    renderTestingPage();
    await user.click((await screen.findAllByRole('button', { name: 'Create test' }))[0]);
    await user.type(screen.getByLabelText('Name'), 'Tokenized target');
    fireEvent.change(screen.getByLabelText('Test URL'), {
      target: { value: 'https://catalog.example.test/items?access_token=do-not-submit' },
    });
    await user.click(within(screen.getByRole('form', { name: 'Create API test' })).getByRole('button', { name: 'Create test' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/do not put credentials in the url/i);
    expect(screen.getByLabelText('Name')).toHaveValue('Tokenized target');
    expect(mockFetch.mock.calls.some(([url, init]) =>
      url === '/api/v1/apis/api-1/tests' && (init as RequestInit).method === 'POST',
    )).toBe(false);
  });

  it('retains the test definition and reports backend validation errors', async () => {
    const user = userEvent.setup();
    queueResponses([
      ...inventoryResponses(),
      jsonResponse({ data: [] }),
      jsonResponse({ error: { code: 'INVALID_TEST_DEFINITION', message: 'The test target is not allowed.' } }, 400),
    ]);
    renderTestingPage();
    await user.click((await screen.findAllByRole('button', { name: 'Create test' }))[0]);
    const form = screen.getByRole('form', { name: 'Create API test' });
    await user.type(within(form).getByLabelText('Name'), 'Rejected target');
    await user.type(within(form).getByLabelText('Test URL'), 'https://catalog.example.test/private');
    fireEvent.change(within(form).getByLabelText('Assertions (JSON array)'), {
      target: { value: '[{"type":"STATUS_CODE","operator":"EQUALS","expected":200}]' },
    });
    await user.click(within(form).getByRole('button', { name: 'Create test' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The test target is not allowed.');
    expect(within(form).getByLabelText('Name')).toHaveValue('Rejected target');
    expect(within(form).getByLabelText('Test URL')).toHaveValue('https://catalog.example.test/private');
  });
});
