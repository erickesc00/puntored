'use client';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ProtectedRouteGate,
  SessionProvider,
  useSession,
} from './session-provider';

const replaceMock = vi.fn();
const pathnameMock = vi.fn();
const useSearchParamsMock = vi.fn();
const routerMock = { replace: replaceMock };

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => pathnameMock(),
  useSearchParams: () => useSearchParamsMock(),
}));

const jsonResponse = (status: number, body?: unknown) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: status === 204
      ? undefined
      : {
          'content-type': 'application/json',
        },
    statusText: status >= 400 ? 'Request failed' : 'OK',
  });

function SessionActionsHarness() {
  const { login, status, user } = useSession();

  return (
    <div>
      <button
        onClick={() =>
          void login({
            username: 'operator',
            password: 'secret-123',
            returnTo: '/references',
          })
        }
        type="button"
      >
        Trigger login
      </button>
      <span data-testid="session-status">{status}</span>
      <span data-testid="session-username">{user?.username ?? 'anonymous'}</span>
    </div>
  );
}

describe('ProtectedRouteGate', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    replaceMock.mockReset();
    pathnameMock.mockReturnValue('/references/detail');
    useSearchParamsMock.mockReturnValue(
      new URLSearchParams('filter=pending'),
    );
  });

  it('bootstraps /auth/me and renders protected content', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      jsonResponse(200, {
        user: {
          id: 'u-1',
          username: 'operator',
          role: 'operator',
        },
      }),
    );

    render(
      <SessionProvider>
        <ProtectedRouteGate>
          <div>Protected workspace</div>
        </ProtectedRouteGate>
      </SessionProvider>,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Validando sesión...');

    expect(await screen.findByText('Protected workspace')).toBeInTheDocument();
    expect(screen.getAllByText('operator')).toHaveLength(2);
    expect(global.fetch).toHaveBeenCalledWith('/api/auth/me', expect.objectContaining({
      cache: 'no-store',
      credentials: 'include',
      method: 'GET',
    }));
  });

  it('logs in successfully and redirects to /references after /auth/me bootstrap', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse(201, {}))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          user: {
            id: 'u-1',
            username: 'operator',
            role: 'operator',
          },
        }),
      );

    const user = userEvent.setup();

    render(
      <SessionProvider>
        <SessionActionsHarness />
      </SessionProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Trigger login' }));

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/references');
    });

    expect(screen.getByTestId('session-status')).toHaveTextContent(
      'authenticated',
    );
    expect(screen.getByTestId('session-username')).toHaveTextContent('operator');
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      '/api/auth/login',
      expect.objectContaining({
        body: JSON.stringify({ username: 'operator', password: 'secret-123' }),
        cache: 'no-store',
        credentials: 'include',
        method: 'POST',
      }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      '/api/auth/me',
      expect.objectContaining({
        cache: 'no-store',
        credentials: 'include',
        method: 'GET',
      }),
    );
  });

  it.each([
    ['SESSION_REQUIRED', 'required'],
    ['SESSION_EXPIRED', 'expired'],
  ])(
    'redirects to login when /auth/me returns %s',
    async (code, reason) => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(
        jsonResponse(401, {
          code,
          message: 'Auth lost',
        }),
      );

      render(
        <SessionProvider>
          <ProtectedRouteGate>
            <div>Protected workspace</div>
          </ProtectedRouteGate>
        </SessionProvider>,
      );

      await waitFor(() => {
        expect(replaceMock).toHaveBeenCalledWith(
          `/login?reason=${reason}&returnTo=%2Freferences%2Fdetail%3Ffilter%3Dpending`,
        );
      });
      expect(screen.queryByText('Protected workspace')).not.toBeInTheDocument();
    },
  );

  it('shows a recoverable error state when /auth/me fails for a non-auth reason', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse(500, {
          code: 'UNKNOWN_ERROR',
          message: 'Boom',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          user: {
            id: 'u-1',
            username: 'operator',
            role: 'operator',
          },
        }),
      );

    const user = userEvent.setup();

    render(
      <SessionProvider>
        <ProtectedRouteGate>
          <div>Protected workspace</div>
        </ProtectedRouteGate>
      </SessionProvider>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No pudimos validar tu sesión. Probá nuevamente.',
    );

    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    expect(await screen.findByText('Protected workspace')).toBeInTheDocument();
  });

  it('logs out, removes protected access, and redirects to /login', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse(200, {
          user: {
            id: 'u-1',
            username: 'operator',
            role: 'operator',
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(204));

    const user = userEvent.setup();

    render(
      <SessionProvider>
        <ProtectedRouteGate>
          <div>Protected workspace</div>
        </ProtectedRouteGate>
      </SessionProvider>,
    );

    expect(await screen.findByText('Protected workspace')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/login');
    });

    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      '/api/auth/logout',
      expect.objectContaining({
        cache: 'no-store',
        credentials: 'include',
        method: 'POST',
      }),
    );
    await waitFor(() => {
      expect(screen.queryByText('Protected workspace')).not.toBeInTheDocument();
    });
  });
});
