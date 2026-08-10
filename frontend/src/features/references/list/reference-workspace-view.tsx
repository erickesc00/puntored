import Link from "next/link";
import { FeedbackBanner } from "@/components/feedback-banner";
import { formatDateTime, formatMoney, statusLabel } from "@/features/references/shared/presentation";
import type { ReferenceStatus } from "@/features/references/shared/types";
import type { ReferenceWorkspaceController } from "./use-reference-workspace-controller";

export function ReferenceWorkspaceView({
  controller,
}: {
  controller: ReferenceWorkspaceController;
}) {
  const {
    buildDetailHref,
    createdId,
    draftState,
    errorCode,
    errorMessage,
    goToNextPage,
    goToPreviousPage,
    hasActiveFilters,
    isLoading,
    items,
    nextCursor,
    page,
    previousPageDisabled,
    resetFilters,
    resetPagination,
    retry,
    setCreatedFrom,
    setCreatedTo,
    setLimit,
    setSearch,
    setStatus,
    submitFilters,
  } = controller;

  return (
    <section className="workspace stack" aria-labelledby="workspace-title">
      <div className="workspace-heading">
        <div className="stack stack-sm page-heading-copy">
          <p className="eyebrow">Referencias</p>
          <h1 id="workspace-title">Workspace de referencias</h1>
        </div>

        <Link className="primary-link primary-link-with-icon" href="/references/new">
          <PlusIcon />
          Crear referencia
        </Link>
      </div>

      {createdId ? (
        <FeedbackBanner tone="status">
          Referencia creada correctamente. ID: <strong>{createdId}</strong>
        </FeedbackBanner>
      ) : null}

      <section className="card stack filters-card" aria-labelledby="filters-title">
        <div className="stack stack-sm">
          <h2 id="filters-title">Filtros</h2>
        </div>

        <form
          className="stack filters-form"
          onSubmit={(event) => {
            event.preventDefault();
            submitFilters();
          }}
        >
          <div className="filters-grid filters-grid-five">
            <TextFilterField
              id="search"
              label="Buscar Concepto"
              onChange={setSearch}
              placeholder="Concepto o referencia externa"
              value={draftState.search}
            />

            <StatusFilterField
              onChange={setStatus}
              value={draftState.status}
            />

            <DateFilterField
              id="createdFrom"
              label="Creada desde"
              onChange={setCreatedFrom}
              value={draftState.createdFrom}
            />

            <DateFilterField
              id="createdTo"
              label="Creada hasta"
              onChange={setCreatedTo}
              value={draftState.createdTo}
            />

            <LimitFilterField onChange={setLimit} value={draftState.limit} />
          </div>

          <div className="filters-actions">
            <button
              className="secondary-button secondary-button-outline"
              onClick={resetFilters}
              type="button"
            >
              Limpiar
            </button>
            <button className="primary-button primary-button-dark" type="submit">
              <FilterIcon />
              <span>Aplicar filtros</span>
            </button>
          </div>
        </form>
      </section>

      <section className="card stack results-card" aria-labelledby="results-title">
        <div className="workspace-results-header">
          <div className="stack stack-sm">
            <h2 id="results-title">Resultados</h2>
            <p className="muted-copy">
              Página {page} · {items.length} resultado{items.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className="pagination-summary" aria-live="polite">
            {hasActiveFilters ? "Vista filtrada" : "Vista completa"}
          </div>
        </div>

        {errorMessage ? (
          <FeedbackBanner
            tone={errorCode === "INVALID_CURSOR" ? "notice" : "error"}
            actions={
              <div className="detail-actions">
                {errorCode === "INVALID_CURSOR" ? (
                  <button
                    className="secondary-button secondary-button-outline"
                    onClick={resetPagination}
                    type="button"
                  >
                    Volver a la primera página
                  </button>
                ) : null}
                <button className="secondary-button" onClick={retry} type="button">
                  Reintentar
                </button>
              </div>
            }
          >
            {errorMessage}
          </FeedbackBanner>
        ) : null}

        {isLoading ? (
          <div className="loading-panel" role="status" aria-live="polite">
            Cargando referencias...
          </div>
        ) : null}

        {!isLoading && !errorMessage && items.length === 0 ? (
          <div className="empty-state stack stack-sm" role="status">
            <h3>No hay referencias para mostrar</h3>
            <p>
              {hasActiveFilters
                ? "Intenta ajustar la búsqueda o limpiar los filtros."
                : "Todavía no has creado referencias. Puedes registrar la primera ahora mismo."}
            </p>
            {!hasActiveFilters ? (
              <Link className="primary-link" href="/references/new">
                Crear primera referencia
              </Link>
            ) : null}
          </div>
        ) : null}

        {!errorMessage && items.length > 0 ? (
          <>
            <div className="workspace-table-wrap" aria-busy={isLoading}>
              <table className="workspace-table">
                <caption className="sr-only">Listado de referencias paginado</caption>
                <thead>
                  <tr>
                    <th scope="col">Concepto</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Monto</th>
                    <th scope="col">Vence</th>
                    <th scope="col">Creada</th>
                    <th scope="col">Creada por</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <ReferenceWorkspaceRow
                      item={item}
                      key={item.id}
                      detailHref={buildDetailHref(item.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="reference-card-list" aria-label="Listado móvil de referencias">
              {items.map((item) => (
                <ReferenceWorkspaceCard
                  item={item}
                  key={item.id}
                  detailHref={buildDetailHref(item.id)}
                />
              ))}
            </div>
          </>
        ) : null}

        <div className="pagination-actions" role="navigation" aria-label="Paginación del listado">
          <button
            className="secondary-button"
            disabled={previousPageDisabled}
            onClick={goToPreviousPage}
            type="button"
          >
            Página anterior
          </button>
          <button
            className="secondary-button"
            disabled={!nextCursor || isLoading}
            onClick={goToNextPage}
            type="button"
          >
            Página siguiente
          </button>
        </div>
      </section>
    </section>
  );
}

function TextFilterField({
  id,
  label,
  onChange,
  placeholder,
  value,
}: {
  id: string;
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        name={id}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </label>
  );
}

function StatusFilterField({
  onChange,
  value,
}: {
  onChange: (value: ReferenceStatus | null) => void;
  value: ReferenceStatus | null;
}) {
  return (
    <label className="field" htmlFor="status">
      <span>Estado</span>
      <select
        id="status"
        name="status"
        onChange={(event) =>
          onChange(event.target.value ? (event.target.value as ReferenceStatus) : null)
        }
        value={value ?? ""}
      >
        <option value="">Todos</option>
        <option value="PENDING">Pendiente</option>
        <option value="PAID">Pagada</option>
        <option value="CANCELLED">Cancelada</option>
        <option value="EXPIRED">Expirada</option>
      </select>
    </label>
  );
}

function DateFilterField({
  id,
  label,
  onChange,
  value,
}: {
  id: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        name={id}
        onChange={(event) => onChange(event.target.value)}
        type="date"
        value={value}
      />
    </label>
  );
}

function LimitFilterField({
  onChange,
  value,
}: {
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <label className="field" htmlFor="limit">
      <span>Resultados por pág.</span>
      <select
        id="limit"
        name="limit"
        onChange={(event) => onChange(Number(event.target.value))}
        value={String(value)}
      >
        <option value="10">10</option>
        <option value="20">20</option>
        <option value="50">50</option>
      </select>
    </label>
  );
}

function ReferenceWorkspaceRow({
  detailHref,
  item,
}: {
  detailHref: string;
  item: ReferenceWorkspaceController["items"][number];
}) {
  return (
    <tr>
      <td>
        <div className="table-primary">{item.concept}</div>
        <div className="table-secondary">{item.externalReference ?? "Sin referencia externa"}</div>
        <Link
          aria-label={`Ver detalle de ${item.concept}`}
          className="text-link table-detail-link"
          href={detailHref}
        >
          Ver detalle
        </Link>
      </td>
      <td>
        <span className={`status-pill status-${item.status.toLowerCase()}`}>
          {statusLabel(item.status)}
        </span>
      </td>
      <td>{formatMoney(item.amount, item.currency)}</td>
      <td>{formatDateTime(item.dueDate)}</td>
      <td>{formatDateTime(item.createdAt)}</td>
      <td>{item.createdBy.username ?? item.createdBy.id}</td>
    </tr>
  );
}

function ReferenceWorkspaceCard({
  detailHref,
  item,
}: {
  detailHref: string;
  item: ReferenceWorkspaceController["items"][number];
}) {
  return (
    <article className="reference-card">
      <div className="stack stack-sm">
        <div className="reference-card-header">
          <strong>{item.concept}</strong>
          <span className={`status-pill status-${item.status.toLowerCase()}`}>
            {statusLabel(item.status)}
          </span>
        </div>
        <dl className="reference-card-grid">
          <div>
            <dt>Monto</dt>
            <dd>{formatMoney(item.amount, item.currency)}</dd>
          </div>
          <div>
            <dt>Vence</dt>
            <dd>{formatDateTime(item.dueDate)}</dd>
          </div>
          <div>
            <dt>Creada</dt>
            <dd>{formatDateTime(item.createdAt)}</dd>
          </div>
          <div>
            <dt>Creada por</dt>
            <dd>{item.createdBy.username ?? item.createdBy.id}</dd>
          </div>
          <div>
            <dt>Referencia externa</dt>
            <dd>{item.externalReference ?? "Sin referencia externa"}</dd>
          </div>
        </dl>
        <Link aria-label={`Ver detalle de ${item.concept}`} className="text-link" href={detailHref}>
          Ver detalle
        </Link>
      </div>
    </article>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        d="M12 5.25a.75.75 0 0 1 .75.75v5.25H18a.75.75 0 0 1 0 1.5h-5.25V18a.75.75 0 0 1-1.5 0v-5.25H6a.75.75 0 0 1 0-1.5h5.25V6a.75.75 0 0 1 .75-.75Z"
        fill="currentColor"
      />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        d="M4.75 6A.75.75 0 0 1 5.5 5.25h13a.75.75 0 0 1 .53 1.28l-5.28 5.28v5.44a.75.75 0 0 1-1.17.62l-2.5-1.75a.75.75 0 0 1-.33-.62v-3.69L4.97 6.53A.75.75 0 0 1 4.75 6Z"
        fill="currentColor"
      />
    </svg>
  );
}
