import { Suspense, type ReactNode } from 'react';
import { ProtectedRouteGate } from '@/lib/session/session-provider';

export default function ProtectedLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <Suspense
      fallback={
        <div className="loading-shell">
          <div className="card">
            <p role="status">Validando sesión...</p>
          </div>
        </div>
      }
    >
      <ProtectedRouteGate>{children}</ProtectedRouteGate>
    </Suspense>
  );
}
