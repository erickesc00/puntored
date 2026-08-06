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
        setBootstrapError('No pudimos validar tu sesión. Probá nuevamente.');
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
        <div>
          <strong>{user.username}</strong>
          <span>{user.role}</span>
        </div>
        <button className="secondary-button" onClick={() => void logout()} type="button">
          Cerrar sesión
        </button>
      </header>
      <main className="protected-main">{children}</main>
    </div>
  );
}
