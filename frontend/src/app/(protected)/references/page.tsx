export default function ReferencesPage() {
  return (
    <section className="card stack" aria-labelledby="workspace-title">
      <div className="stack">
        <h1 id="workspace-title">Workspace protegido listo</h1>
        <p>
          La autenticación, el bootstrap por <code>/auth/me</code> y el logout ya
          están cableados. El listado/alta/detalle de referencias llega en el
          siguiente work-unit.
        </p>
      </div>
      <div className="status-banner" role="status">
        Sesión protegida inicializada correctamente.
      </div>
    </section>
  );
}
