import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';
import { apiRequest } from './lib/api';

const mockFetch = vi.fn();

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: vi.fn().mockResolvedValue(body),
  }) as unknown as Response;

const currentUser = {
  id: 'user-1',
  githubId: 123,
  githubUsername: 'gatewatch-user',
  email: 'user@example.com',
  avatarUrl: null,
  status: 'ACTIVE' as const,
  isAdmin: false,
};

const authenticatedResponse = (): Response => jsonResponse({ data: currentUser });
const unauthenticatedResponse = (): Response =>
  jsonResponse(
    {
      error: {
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication is required.',
      },
    },
    401,
  );

describe('GateWatch application', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the login view when the user is unauthenticated', async () => {
    mockFetch.mockResolvedValueOnce(unauthenticatedResponse());

    render(<App />);

    expect(
      await screen.findByRole('heading', { name: /sign in to gatewatch/i }),
    ).toBeInTheDocument();
  });

  it('restores a valid session and shows the dashboard', async () => {
    mockFetch
      .mockResolvedValueOnce(authenticatedResponse())
      .mockResolvedValueOnce(jsonResponse({ data: [] }));

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('gatewatch-user')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'gatewatch-user profile picture' })).toHaveTextContent('GA');
  });

  it('loads the sidebar avatar from auth/me and falls back when the image fails', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({
        data: { ...currentUser, avatarUrl: 'https://avatars.example.test/gatewatch.png' },
      }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));

    render(<App />);

    const avatar = await screen.findByRole('img', { name: 'gatewatch-user profile picture' });
    const image = avatar.querySelector('img');
    expect(image).toHaveAttribute('src', 'https://avatars.example.test/gatewatch.png');
    if (!image) throw new Error('The avatar image was not rendered.');
    fireEvent.error(image);
    expect(avatar).toHaveTextContent('GA');
    expect(avatar.querySelector('img')).not.toBeInTheDocument();
  });

  it('shows supported account settings and gracefully omits an unavailable email', async () => {
    window.history.replaceState(null, '', '/settings');
    mockFetch.mockResolvedValueOnce(jsonResponse({
      data: { ...currentUser, email: null, avatarUrl: 'https://avatars.example.test/settings.png' },
    }));

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'gatewatch-user' })).toBeInTheDocument();
    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    const profile = screen.getByRole('heading', { name: 'gatewatch-user' }).closest('section');
    if (!profile) throw new Error('The settings profile section is missing.');
    expect(within(profile).getByRole('img', { name: 'gatewatch-user profile picture' }).querySelector('img'))
      .toHaveAttribute('src', 'https://avatars.example.test/settings.png');
    expect(screen.queryByText('Email')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it('redirects an unauthenticated protected route to login', async () => {
    window.history.replaceState(null, '', '/settings');
    mockFetch.mockResolvedValueOnce(unauthenticatedResponse());

    render(<App />);

    expect(
      await screen.findByRole('heading', { name: /sign in to gatewatch/i }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
  });

  it('keeps a backend 403 distinct from an unauthenticated session', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(
        { error: { code: 'ACCESS_DENIED', message: 'Access is not permitted.' } },
        403,
      ),
    );

    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Access is not permitted.');
  });

  it('maps backend API errors to an ApiError with status and backend code', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(
        { error: { code: 'AUTHENTICATION_CHECK_FAILED', message: 'Check failed.' } },
        500,
      ),
    );

    await expect(apiRequest('/api/v1/auth/me')).rejects.toMatchObject({
      name: 'ApiError',
      status: 500,
      code: 'AUTHENTICATION_CHECK_FAILED',
      message: 'Check failed.',
    });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/auth/me',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('reports a network failure without inventing an HTTP status', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(apiRequest('/api/v1/auth/me')).rejects.toMatchObject({
      name: 'ApiError',
      status: null,
      message: 'Unable to reach the GateWatch server. Please check your connection and try again.',
    });
  });

  it('clears protected UI and explains when logout cannot be confirmed', async () => {
    mockFetch
      .mockResolvedValueOnce(authenticatedResponse())
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: 'LOGOUT_FAILED', message: 'Failed to log out.' } },
          500,
        ),
      );

    render(<App />);
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Dashboard' });
    await user.click(screen.getByRole('button', { name: 'Logout' }));

    expect(mockFetch).toHaveBeenLastCalledWith(
      '/api/v1/auth/logout',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your GateWatch session may still be active.',
    );
    expect(
      screen.getByRole('heading', { name: /sign in to gatewatch/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
  });

  it('returns to login after the backend confirms logout', async () => {
    mockFetch
      .mockResolvedValueOnce(authenticatedResponse())
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce({ ok: true, status: 204 } as Response);

    render(<App />);
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Dashboard' });
    await user.click(screen.getByRole('button', { name: 'Logout' }));

    expect(mockFetch).toHaveBeenLastCalledWith(
      '/api/v1/auth/logout',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
    expect(
      await screen.findByRole('heading', { name: /sign in to gatewatch/i }),
    ).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe('/login'));
  });
});
