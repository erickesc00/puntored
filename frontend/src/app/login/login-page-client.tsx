'use client';

import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiClientError } from '@/lib/api/errors';
import { useSession } from '@/lib/session/session-provider';

const reasonMessageByCode: Record<string, string> = {
  expired: 'Tu sesión venció. Volvé a iniciar sesión para continuar.',
  required: 'Necesitás iniciar sesión para continuar.',
};

export function LoginPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, refreshSession, status, user } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const returnTo = useMemo(() => {
    const requested = searchParams.get('returnTo');

    if (!requested || !requested.startsWith('/') || requested.startsWith('//')) {
      return '/references';
    }

    return requested;
  }, [searchParams]);

  const reasonCode = searchParams.get('reason') ?? '';

  useEffect(() => {
    if (user) {
      router.replace(returnTo);
      return;
    }

    if (status === 'idle') {
      void refreshSession({ redirectOnAuthLoss: false });
    }
  }, [refreshSession, returnTo, router, status, user]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await login({ username, password, returnTo });
    } catch (error) {
      if (error instanceof ApiClientError) {
        setErrorMessage(
          error.code === 'INVALID_CREDENTIALS'
            ? 'Credenciales inválidas.'
            : 'No pudimos iniciar sesión. Probá nuevamente.',
        );
      } else {
        setErrorMessage('No pudimos iniciar sesión. Probá nuevamente.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="page-shell">
      <section className="card stack" aria-labelledby="login-title">
        <div className="stack">
          <h1 id="login-title">Puntored MVP</h1>
          <p>
            Iniciá sesión con un usuario interno para entrar al workspace de
            referencias.
          </p>
        </div>

        {reasonMessageByCode[reasonCode] ? (
          <div className="notice" role="status">
            {reasonMessageByCode[reasonCode]}
          </div>
        ) : null}

        {errorMessage ? (
          <div className="error-banner" role="alert" aria-live="polite">
            {errorMessage}
          </div>
        ) : null}

        <form className="form-stack" onSubmit={handleSubmit}>
          <label className="field" htmlFor="username">
            <span>Usuario</span>
            <input
              id="username"
              name="username"
              autoComplete="username"
              onChange={(event) => setUsername(event.target.value)}
              required
              value={username}
            />
          </label>

          <label className="field" htmlFor="password">
            <span>Password</span>
            <input
              id="password"
              name="password"
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>

          <button className="primary-button" disabled={isSubmitting} type="submit">
            {isSubmitting ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>
      </section>
    </main>
  );
}
