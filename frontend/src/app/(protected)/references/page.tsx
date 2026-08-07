import { Suspense } from 'react';
import { ReferenceWorkspace } from '@/features/references/list/reference-workspace';

export default function ReferencesPage() {
  return (
    <Suspense
      fallback={
        <section className="card stack" aria-busy="true" aria-labelledby="workspace-title">
          <div className="stack">
            <h1 id="workspace-title">Cargando referencias...</h1>
            <p role="status">Estamos preparando tu workspace protegido.</p>
          </div>
        </section>
      }
    >
      <ReferenceWorkspace />
    </Suspense>
  );
}
