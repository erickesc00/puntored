import { Suspense } from 'react';
import { LoginPageClient } from './login-page-client';

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="page-shell">
          <section className="card">
            <p role="status">Cargando login...</p>
          </section>
        </main>
      }
    >
      <LoginPageClient />
    </Suspense>
  );
}
