'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ApiClientError } from '@/lib/api/errors';
import { useSession } from '@/lib/session/session-provider';
import type { ReferenceSummary } from '@/features/references/shared/types';
import { fetchReferenceList } from './api';
import {
  buildReferenceListSearchParams,
  createInitialReferenceListState,
  getNextReferenceListState,
  getPreviousReferenceListState,
  getReferenceListPage,
  parseReferenceListUrlState,
  type ReferenceListUrlState,
} from './query-state';

const statusLabel: Record<string, string> = {
  PENDING: 'Pendiente',
  PAID: 'Pagada',
  CANCELLED: 'Cancelada',
  EXPIRED: 'Expirada',
};

const listErrorMessage = (error: ApiClientError) => {
  if (error.code === 'INVALID_CURSOR') {
    return 'La página pedida ya no es válida. Volvé a intentar desde el listado.';
  }

  return 'No pudimos cargar las referencias. Probá nuevamente.';
};

const formatMoney = (amount: number, currency: string) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount / 100);

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));

export function ReferenceWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { handleSessionError } = useSession();
  const currentUrl = useMemo(() => {
    const query = searchParams.toString();
    return query.length > 0 ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);

  const urlState = useMemo(
    () => parseReferenceListUrlState(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  const [draftState, setDraftState] = useState<ReferenceListUrlState>(urlState);
  const [items, setItems] = useState<ReferenceSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    setDraftState(urlState);
  }, [urlState]);

  useEffect(() => {
    let cancelled = false;

    setIsLoading(true);
    setErrorMessage(null);

    void fetchReferenceList(urlState)
      .then((response) => {
        if (cancelled) {
          return;
        }

        setItems(response.items);
        setNextCursor(response.pageInfo.nextCursor);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        if (handleSessionError(error, currentUrl)) {
          return;
        }

        setItems([]);
        setNextCursor(null);
        setErrorMessage(
          error instanceof ApiClientError
            ? listErrorMessage(error)
            : 'No pudimos cargar las referencias. Probá nuevamente.',
        );
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentUrl, handleSessionError, retryNonce, urlState]);

  const updateUrl = (nextState: ReferenceListUrlState) => {
    const query = buildReferenceListSearchParams(nextState).toString();
    router.push(query.length > 0 ? `${pathname}?${query}` : pathname);
  };

  const applyFilters = () => {
    updateUrl({
      ...draftState,
      search: draftState.search.trim(),
      cursor: null,
      trail: [],
    });
  };

  const resetFilters = () => {
    const nextState = createInitialReferenceListState();
    setDraftState(nextState);
    updateUrl(nextState);
  };

  const hasActiveFilters = Boolean(
    urlState.search || urlState.status || urlState.createdFrom || urlState.createdTo,
  );
  const page = getReferenceListPage(urlState);
  const previousState = getPreviousReferenceListState(urlState);
  const createdId = searchParams.get('created');
  const buildDetailHref = (referenceId: string) =>
    `/references/${referenceId}?returnTo=${encodeURIComponent(currentUrl)}`;

  return (
    <section className="workspace stack" aria-labelledby="workspace-title">
      <div className="workspace-heading">
        <div className="stack stack-sm">
          <p className="eyebrow">Referencias</p>
          <h1 id="workspace-title">Workspace de referencias</h1>
          <p className="workspace-copy">
            Buscá, filtrá y recorré referencias desde la URL para poder refrescar o
            volver atrás sin perder contexto.
          </p>
        </div>

        <Link className="primary-link" href="/references/new">
          Crear referencia
        </Link>
      </div>

      {createdId ? (
        <div className="status-banner" role="status" aria-live="polite">
          Referencia creada correctamente. ID: <strong>{createdId}</strong>
        </div>
      ) : null}

      <section className="card stack" aria-labelledby="filters-title">
        <div className="stack stack-sm">
          <h2 id="filters-title">Filtros</h2>
          <p className="muted-copy">
            El estado del listado vive en la URL: búsqueda, filtros y página actual.
          </p>
        </div>

        <form
          className="filters-grid"
          onSubmit={(event) => {
            event.preventDefault();
            applyFilters();
          }}
        >
          <label className="field" htmlFor="search">
            <span>Buscar</span>
            <input
              id="search"
              name="search"
              onChange={(event) =>
                setDraftState((current) => ({
                  ...current,
                  search: event.target.value,
                }))
              }
              placeholder="Concepto o referencia externa"
              value={draftState.search}
            />
          </label>

          <label className="field" htmlFor="status">
            <span>Estado</span>
            <select
              id="status"
              name="status"
              onChange={(event) =>
                setDraftState((current) => ({
                  ...current,
                  status: event.target.value ? (event.target.value as ReferenceListUrlState['status']) : null,
                }))
              }
              value={draftState.status ?? ''}
            >
              <option value="">Todos</option>
              <option value="PENDING">Pendiente</option>
              <option value="PAID">Pagada</option>
              <option value="CANCELLED">Cancelada</option>
              <option value="EXPIRED">Expirada</option>
            </select>
          </label>

          <label className="field" htmlFor="createdFrom">
            <span>Creada desde</span>
            <input
              id="createdFrom"
              name="createdFrom"
              onChange={(event) =>
                setDraftState((current) => ({
                  ...current,
                  createdFrom: event.target.value,
                }))
              }
              type="date"
              value={draftState.createdFrom}
            />
          </label>

          <label className="field" htmlFor="createdTo">
            <span>Creada hasta</span>
            <input
              id="createdTo"
              name="createdTo"
              onChange={(event) =>
                setDraftState((current) => ({
                  ...current,
                  createdTo: event.target.value,
                }))
              }
              type="date"
              value={draftState.createdTo}
            />
          </label>

          <label className="field" htmlFor="limit">
            <span>Resultados por página</span>
            <select
              id="limit"
              name="limit"
              onChange={(event) =>
                setDraftState((current) => ({
                  ...current,
                  limit: Number(event.target.value),
                }))
              }
              value={String(draftState.limit)}
            >
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
            </select>
          </label>

          <div className="filters-actions">
            <button className="primary-button" type="submit">
              Aplicar filtros
            </button>
            <button className="secondary-button" onClick={resetFilters} type="button">
              Limpiar
            </button>
          </div>
        </form>
      </section>

      <section className="card stack" aria-labelledby="results-title">
        <div className="workspace-results-header">
          <div className="stack stack-sm">
            <h2 id="results-title">Resultados</h2>
            <p className="muted-copy">
              Página {page} · {items.length} resultado{items.length === 1 ? '' : 's'}
            </p>
          </div>
          <div className="pagination-summary" aria-live="polite">
            {hasActiveFilters ? 'Vista filtrada' : 'Vista completa'}
          </div>
        </div>

        {errorMessage ? (
          <div className="error-banner stack stack-sm" role="alert" aria-live="polite">
            <span>{errorMessage}</span>
            <button
              className="secondary-button"
              onClick={() => setRetryNonce((current) => current + 1)}
              type="button"
            >
              Reintentar
            </button>
          </div>
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
                ? 'Probá ajustar la búsqueda o limpiar los filtros.'
                : 'Todavía no creaste referencias. Podés cargar la primera ahora mismo.'}
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
                    <tr key={item.id}>
                      <td>
                       <div className="table-primary">{item.concept}</div>
                       <div className="table-secondary">{item.externalReference ?? 'Sin referencia externa'}</div>
                       <Link
                         aria-label={`Ver detalle de ${item.concept}`}
                         className="text-link table-detail-link"
                         href={buildDetailHref(item.id)}
                       >
                         Ver detalle
                       </Link>
                      </td>
                      <td>
                        <span className={`status-pill status-${item.status.toLowerCase()}`}>
                          {statusLabel[item.status]}
                        </span>
                      </td>
                      <td>{formatMoney(item.amount, item.currency)}</td>
                      <td>{formatDateTime(item.dueDate)}</td>
                      <td>{formatDateTime(item.createdAt)}</td>
                      <td>{item.createdBy.username ?? item.createdBy.id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="reference-card-list" aria-label="Listado móvil de referencias">
              {items.map((item) => (
                <article className="reference-card" key={item.id}>
                  <div className="stack stack-sm">
                    <div className="reference-card-header">
                      <strong>{item.concept}</strong>
                      <span className={`status-pill status-${item.status.toLowerCase()}`}>
                        {statusLabel[item.status]}
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
                        <dd>{item.externalReference ?? 'Sin referencia externa'}</dd>
                      </div>
                    </dl>
                    <Link
                      aria-label={`Ver detalle de ${item.concept}`}
                      className="text-link"
                      href={buildDetailHref(item.id)}
                    >
                      Ver detalle
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : null}

        <div className="pagination-actions" role="navigation" aria-label="Paginación del listado">
          <button
            className="secondary-button"
            disabled={!previousState || isLoading}
            onClick={() => previousState && updateUrl(previousState)}
            type="button"
          >
            Página anterior
          </button>
          <button
            className="secondary-button"
            disabled={!nextCursor || isLoading}
            onClick={() => nextCursor && updateUrl(getNextReferenceListState(urlState, nextCursor))}
            type="button"
          >
            Página siguiente
          </button>
        </div>
      </section>
    </section>
  );
}
