'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { apiClient } from '@/lib/api/client';
import { ApiClientError, isSessionLossError } from '@/lib/api/errors';

type SessionStatus = 'idle' | 'loading' | 'authenticated' | 'anonymous';
type AuthLossReason = 'required' | 'expired';

interface SessionUserResponse {
  id: string;
  username: string;
  role: string;
}

interface AuthMeResponse {
  user: SessionUserResponse;
}

export interface SessionUser {
  userId: string;
  username: string;
  role: string;
}

interface RefreshSessionOptions {
  redirectOnAuthLoss?: boolean;
  returnTo?: string;
}

interface LoginOptions {
  username: string;
  password: string;
  returnTo?: string;
}

interface SessionContextValue {
  user: SessionUser | null;
  status: SessionStatus;
  bootstrapError: string | null;
  login: (options: LoginOptions) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: (
    options?: RefreshSessionOptions,
  ) => Promise<SessionUser | null>;
  handleSessionError: (error: unknown, returnTo?: string) => boolean;
}

const LOGIN_PATH = '/login';
const DEFAULT_PROTECTED_PATH = '/references';

const SessionContext = createContext<SessionContextValue | null>(null);

const sanitizeReturnTo = (returnTo?: string | null) => {
  if (!returnTo || !returnTo.startsWith('/') || returnTo.startsWith('//')) {
    return DEFAULT_PROTECTED_PATH;
  }

  return returnTo;
};

const toAuthLossReason = (error: ApiClientError): AuthLossReason =>
  error.code === 'SESSION_EXPIRED' ? 'expired' : 'required';

const buildLoginHref = (reason?: AuthLossReason, returnTo?: string) => {
  const params = new URLSearchParams();

  if (reason) {
    params.set('reason', reason);
  }

  const safeReturnTo = sanitizeReturnTo(returnTo);
  if (safeReturnTo !== DEFAULT_PROTECTED_PATH) {
    params.set('returnTo', safeReturnTo);
  }

  const query = params.toString();
  return query.length > 0 ? `${LOGIN_PATH}?${query}` : LOGIN_PATH;
};

const mapSessionUser = (user: SessionUserResponse): SessionUser => ({
  userId: user.id,
  username: user.username,
  role: user.role,
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  const clearSession = useCallback(() => {
    setUser(null);
    setStatus('anonymous');
    setBootstrapError(null);
  }, []);

  const redirectToLogin = useCallback(
    (reason?: AuthLossReason, returnTo?: string) => {
      clearSession();
      router.replace(buildLoginHref(reason, returnTo));
    },
    [clearSession, router],
  );

  const refreshSession = useCallback(
    async (options?: RefreshSessionOptions) => {
      setBootstrapError(null);
      setStatus((currentStatus) =>
        currentStatus === 'authenticated' ? currentStatus : 'loading',
      );

      try {
        const response = await apiClient.get<AuthMeResponse>('/auth/me');
        const nextUser = mapSessionUser(response.user);

        setUser(nextUser);
        setStatus('authenticated');
        setBootstrapError(null);

        return nextUser;
      } catch (error) {
        if (isSessionLossError(error)) {
          clearSession();

          if (options?.redirectOnAuthLoss) {
            router.replace(
              buildLoginHref(toAuthLossReason(error), options.returnTo),
            );
          }

          return null;
        }

        setUser(null);
        setStatus('anonymous');
        setBootstrapError('No pudimos validar tu sesión. Inténtalo de nuevo.');
        throw error;
      }
    },
    [clearSession, router],
  );

  const login = useCallback(
    async ({ username, password, returnTo }: LoginOptions) => {
      setStatus('loading');

      await apiClient.post('/auth/login', {
        body: { username, password },
      });

      const nextUser = await refreshSession({
        redirectOnAuthLoss: true,
        returnTo,
      });

      if (nextUser) {
        router.replace(sanitizeReturnTo(returnTo));
      }
    },
    [refreshSession, router],
  );

  const logout = useCallback(async () => {
    try {
      await apiClient.post('/auth/logout');
    } catch (error) {
      if (!isSessionLossError(error)) {
        throw error;
      }
    }

    redirectToLogin();
  }, [redirectToLogin]);

  const handleSessionError = useCallback(
    (error: unknown, returnTo?: string) => {
      if (!isSessionLossError(error)) {
        return false;
      }

      redirectToLogin(toAuthLossReason(error), returnTo);
      return true;
    },
    [redirectToLogin],
  );

  const value = useMemo<SessionContextValue>(
    () => ({
      user,
      status,
      bootstrapError,
      login,
      logout,
      refreshSession,
      handleSessionError,
    }),
    [bootstrapError, handleSessionError, login, logout, refreshSession, status, user],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);

  if (!context) {
    throw new Error('useSession must be used within SessionProvider');
  }

  return context;
}

export function ProtectedRouteGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { bootstrapError, logout, refreshSession, status, user } = useSession();

  const returnTo = useMemo(() => {
    const query = searchParams.toString();
    return query.length > 0 ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);

  useEffect(() => {
    void refreshSession({
      redirectOnAuthLoss: true,
      returnTo,
    }).catch(() => undefined);
  }, [refreshSession, returnTo]);

  if (status === 'idle' || status === 'loading') {
    return (
      <div className="loading-shell">
        <div className="card">
          <p role="status">Validando sesión...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    if (bootstrapError) {
      return (
        <div className="loading-shell">
          <div className="card stack">
            <div className="error-banner" role="alert" aria-live="polite">
              {bootstrapError}
            </div>
            <button
              className="secondary-button"
              onClick={() => {
                void refreshSession({
                  redirectOnAuthLoss: true,
                  returnTo,
                }).catch(() => undefined);
              }}
              type="button"
            >
              Reintentar
            </button>
          </div>
        </div>
      );
    }

    return null;
  }

  return (
    <div className="protected-shell">
      <header className="protected-header">
        <div className="protected-brand" aria-label="Puntored">
          Punto<span>red</span>
        </div>
        <div className="protected-user-panel">
          <div className="protected-user-badge" aria-hidden="true">
            {user.username.slice(0, 1).toUpperCase()}
          </div>
          <div className="protected-user-copy">
            <strong>{user.username}</strong>
            <span>{user.role}</span>
          </div>
          <span className="protected-user-divider" aria-hidden="true" />
          <button className="protected-logout-button" onClick={() => void logout()} type="button">
            <LogoutIcon />
            <span>Cerrar sesión</span>
          </button>
        </div>
      </header>
      <main className="protected-main">{children}</main>
    </div>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        d="M13 4.75a.75.75 0 0 1 .75-.75h3.5A2.75 2.75 0 0 1 20 6.75v10.5A2.75 2.75 0 0 1 17.25 20h-3.5a.75.75 0 0 1 0-1.5h3.5c.69 0 1.25-.56 1.25-1.25V6.75c0-.69-.56-1.25-1.25-1.25h-3.5a.75.75 0 0 1-.75-.75Zm-5.72 6.72a.75.75 0 0 0 0 1.06l2.5 2.5a.75.75 0 1 0 1.06-1.06l-1.22-1.22h6.13a.75.75 0 0 0 0-1.5H9.62l1.22-1.22a.75.75 0 1 0-1.06-1.06l-2.5 2.5Z"
        fill="currentColor"
      />
    </svg>
  );
}
