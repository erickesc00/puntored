'use client';

import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiClientError } from '@/lib/api/errors';
import { useSession } from '@/lib/session/session-provider';
import styles from './login-page-client.module.css';

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
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
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
    <main className={styles.pageShell}>
      <section className={styles.card} aria-labelledby="login-title">
        <div className={styles.brandBlock}>
          <div className={styles.wordmark} aria-label="Puntored">
            Punto<span>red</span>
          </div>
          <p className={styles.badge}>GESTOR DE REFERENCIAS</p>
          <div className={styles.headingGroup}>
            <h1 id="login-title" className={styles.title}>
              Ingresá a tu cuenta
            </h1>
            <p className={styles.subtitle}>
              Accedé con tu usuario interno para continuar con la gestión de referencias.
            </p>
          </div>
        </div>

        {reasonMessageByCode[reasonCode] ? (
          <div className={styles.notice} role="status">
            {reasonMessageByCode[reasonCode]}
          </div>
        ) : null}

        {errorMessage ? (
          <div className={styles.errorBanner} role="alert" aria-live="polite">
            {errorMessage}
          </div>
        ) : null}

        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.field} htmlFor="username">
            <span className={styles.label}>Usuario</span>
            <span className={styles.inputShell}>
              <span className={styles.leadingIcon} aria-hidden="true">
                <UserIcon />
              </span>
              <input
                className={styles.input}
                id="username"
                name="username"
                autoComplete="username"
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Ingresá tu usuario"
                required
                value={username}
              />
            </span>
          </label>

          <label className={styles.field} htmlFor="password">
            <span className={styles.label}>Contraseña</span>
            <span className={styles.inputShell}>
              <span className={styles.leadingIcon} aria-hidden="true">
                <LockIcon />
              </span>
              <input
                className={styles.input}
                id="password"
                name="password"
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Ingresá tu contraseña"
                required
                type={isPasswordVisible ? 'text' : 'password'}
                value={password}
              />
              <button
                aria-label={isPasswordVisible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                className={styles.trailingIconButton}
                onClick={() => setIsPasswordVisible((current) => !current)}
                type="button"
              >
                <EyeIcon hidden={isPasswordVisible} />
              </button>
            </span>
          </label>

          <button className={styles.submitButton} disabled={isSubmitting} type="submit">
            {isSubmitting ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>
      </section>
    </main>
  );
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        d="M12 12.25a4.25 4.25 0 1 0-4.25-4.25A4.25 4.25 0 0 0 12 12.25Zm0 1.5c-3.55 0-6.75 1.73-6.75 4.12 0 .35.28.63.63.63h12.24a.63.63 0 0 0 .63-.63c0-2.39-3.2-4.12-6.75-4.12Z"
        fill="currentColor"
      />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        d="M17 9h-.75V7.5a4.25 4.25 0 0 0-8.5 0V9H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2Zm-7.75-1.5a2.75 2.75 0 0 1 5.5 0V9h-5.5ZM12 16.25a1.5 1.5 0 1 1 1.5-1.5 1.5 1.5 0 0 1-1.5 1.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

function EyeIcon({ hidden }: { hidden: boolean }) {
  return hidden ? (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        d="M3.53 2.47a.75.75 0 1 0-1.06 1.06l2.21 2.21A12.6 12.6 0 0 0 1.6 12a12.7 12.7 0 0 0 4.85 4.67 11.7 11.7 0 0 0 5.55 1.58 11.3 11.3 0 0 0 3.64-.64l3.83 3.83a.75.75 0 1 0 1.06-1.06Zm8.47 14.28A9.46 9.46 0 0 1 3.28 12a10.58 10.58 0 0 1 2.48-3.56l2.01 2.01a4.5 4.5 0 0 0 5.78 5.78l1 1a8.84 8.84 0 0 1-2.55.52Zm-.24-3a3 3 0 0 1-3-3 2.84 2.84 0 0 1 .12-.81l3.69 3.69a2.84 2.84 0 0 1-.81.12Zm10.64-1.75a12.63 12.63 0 0 1-4.07 4.18l-1.12-1.12A10.97 10.97 0 0 0 20.72 12 10.8 10.8 0 0 0 12 7.25c-.97 0-1.93.13-2.85.39L7.94 6.43A12.07 12.07 0 0 1 12 5.75 12.3 12.3 0 0 1 22.4 12Z"
        fill="currentColor"
      />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        d="M12 7.25A10.8 10.8 0 0 1 20.72 12 10.8 10.8 0 0 1 12 16.75 10.8 10.8 0 0 1 3.28 12 10.8 10.8 0 0 1 12 7.25Zm0-1.5A12.3 12.3 0 0 0 1.6 12 12.3 12.3 0 0 0 12 18.25 12.3 12.3 0 0 0 22.4 12 12.3 12.3 0 0 0 12 5.75Zm0 3.25A3 3 0 1 1 9 12a3 3 0 0 1 3-3Zm0-1.5A4.5 4.5 0 1 0 16.5 12 4.5 4.5 0 0 0 12 7.5Z"
        fill="currentColor"
      />
    </svg>
  );
}
