'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { cancelReference } from '@/features/references/cancel/api';
import type {
  ReferenceAuditEntry,
  ReferenceDetailResponse,
  ReferenceSummary,
} from '@/features/references/shared/types';
import { ApiClientError } from '@/lib/api/errors';
import { useSession } from '@/lib/session/session-provider';
import { fetchReferenceDetail } from './api';

type FeedbackTone = 'error' | 'status';

interface FeedbackState {
  message: string;
  tone: FeedbackTone;
}

const DEFAULT_RETURN_TO = '/references';

const statusLabel: Record<string, string> = {
  PENDING: 'Pendiente',
  PAID: 'Pagada',
  CANCELLED: 'Cancelada',
  EXPIRED: 'Expirada',
};

const cancelConflictCodes = new Set([
  'REFERENCE_VERSION_CONFLICT',
  'INVALID_REFERENCE_STATE',
  'REFERENCE_EXPIRED',
]);

const sanitizeReturnTo = (value: string | null) => {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return DEFAULT_RETURN_TO;
  }

  return value;
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

const canCancelReference = (reference: ReferenceSummary) =>
  reference.status === 'PENDING';

const formatHistoryTitle = (entry: ReferenceAuditEntry) =>
  `${entry.action.replaceAll('_', ' ')} · ${entry.result.replaceAll('_', ' ')}`;

const formatActor = (entry: ReferenceAuditEntry) => {
  if (!entry.actorId) {
    return entry.actorType;
  }

  return `${entry.actorType} · ${entry.actorId}`;
};

const detailErrorMessage = (error: ApiClientError) => {
  if (error.code === 'REFERENCE_NOT_FOUND') {
    return 'La referencia que buscás ya no existe o no está disponible.';
  }

  return 'No pudimos cargar el detalle de la referencia. Probá nuevamente.';
};

export function ReferenceDetailView({ referenceId }: { referenceId: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { handleSessionError, user } = useSession();
  const [detail, setDetail] = useState<ReferenceDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isNotFound, setIsNotFound] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  const currentUrl = useMemo(() => {
    const query = searchParams.toString();
    return query.length > 0 ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);

  const returnTo = useMemo(
    () => sanitizeReturnTo(searchParams.get('returnTo')),
    [searchParams],
  );

  const loadDetail = useCallback(
    async (nextFeedback: FeedbackState | null = null) => {
      setIsLoading(true);
      setErrorMessage(null);
      setFeedback(nextFeedback);
      setIsNotFound(false);

      try {
        const response = await fetchReferenceDetail(referenceId);
        setDetail(response);
      } catch (error) {
        if (handleSessionError(error, currentUrl)) {
          return;
        }

        setDetail(null);
        setFeedback(null);

        if (
          error instanceof ApiClientError &&
          (error.statusCode === 404 || error.code === 'REFERENCE_NOT_FOUND')
        ) {
          setIsNotFound(true);
          return;
        }

        setErrorMessage(
          error instanceof ApiClientError
            ? detailErrorMessage(error)
            : 'No pudimos cargar el detalle de la referencia. Probá nuevamente.',
        );
      } finally {
        setIsLoading(false);
      }
    },
    [currentUrl, handleSessionError, referenceId],
  );

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const isSupervisor = user?.role?.toUpperCase() === 'SUPERVISOR';
  const canCancel = Boolean(
    detail && isSupervisor && canCancelReference(detail.reference),
  );

  const handleCancelConfirmation = async () => {
    if (!detail) {
      return;
    }

    setIsCancelling(true);

    try {
      await cancelReference(detail.reference.id, detail.reference.version);
      setIsConfirmingCancel(false);
      await loadDetail({
        tone: 'status',
        message:
          'Referencia cancelada correctamente. Refrescamos el detalle con la última versión.',
      });
    } catch (error) {
      if (handleSessionError(error, currentUrl)) {
        return;
      }

      if (
        error instanceof ApiClientError &&
        error.statusCode === 409 &&
        cancelConflictCodes.has(error.code)
      ) {
        setIsConfirmingCancel(false);
        await loadDetail({
          tone: 'status',
          message:
            'La referencia cambió antes de completar la cancelación. Ya refrescamos el detalle con la última versión.',
        });
        return;
      }

      setFeedback({
        tone: 'error',
        message:
          error instanceof ApiClientError
            ? 'No pudimos cancelar la referencia. Probá nuevamente.'
            : 'No pudimos cancelar la referencia. Probá nuevamente.',
      });
    } finally {
      setIsCancelling(false);
    }
  };

  if (isLoading && !detail && !errorMessage && !isNotFound) {
    return (
      <main className="detail-page-shell">
        <section className="card stack" aria-busy="true" aria-labelledby="detail-loading-title">
          <h1 id="detail-loading-title">Cargando detalle...</h1>
          <p role="status">Estamos trayendo la referencia y su historial.</p>
        </section>
      </main>
    );
  }

  if (isNotFound) {
    return (
      <main className="detail-page-shell">
        <section className="card stack" aria-labelledby="detail-not-found-title">
          <p className="eyebrow">Detalle</p>
          <h1 id="detail-not-found-title">Referencia no encontrada</h1>
          <p className="muted-copy">
            La referencia que abriste ya no existe o cambió antes de que pudieras verla.
          </p>
          <div className="detail-actions">
            <Link className="text-link" href={returnTo}>
              Volver al listado
            </Link>
            <button className="secondary-button" onClick={() => void loadDetail()} type="button">
              Reintentar
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (!detail) {
    return (
      <main className="detail-page-shell">
        <section className="card stack" aria-labelledby="detail-error-title">
          <p className="eyebrow">Detalle</p>
          <h1 id="detail-error-title">No pudimos abrir la referencia</h1>
          <div className="error-banner" role="alert" aria-live="polite">
            {errorMessage ?? 'No pudimos cargar el detalle de la referencia. Probá nuevamente.'}
          </div>
          <div className="detail-actions">
            <Link className="text-link" href={returnTo}>
              Volver al listado
            </Link>
            <button className="secondary-button" onClick={() => void loadDetail()} type="button">
              Reintentar
            </button>
          </div>
        </section>
      </main>
    );
  }

  const { reference, history } = detail;

  return (
    <main className="detail-page-shell stack">
      <section className="workspace-heading detail-heading">
        <div className="stack stack-sm">
          <p className="eyebrow">Detalle</p>
          <h1>{reference.concept}</h1>
          <p className="workspace-copy">
            Revisá el estado efectivo, la versión actual y la auditoría asociada a la referencia.
          </p>
        </div>

        <Link className="text-link" href={returnTo}>
          Volver al listado
        </Link>
      </section>

      {feedback ? (
        <div
          className={feedback.tone === 'error' ? 'error-banner' : 'status-banner'}
          role={feedback.tone === 'error' ? 'alert' : 'status'}
          aria-live="polite"
        >
          {feedback.message}
        </div>
      ) : null}

      {errorMessage ? (
        <div className="error-banner" role="alert" aria-live="polite">
          {errorMessage}
        </div>
      ) : null}

      <section className="card stack" aria-labelledby="reference-summary-title">
        <div className="workspace-results-header">
          <h2 id="reference-summary-title">Resumen actual</h2>
          <span className={`status-pill status-${reference.status.toLowerCase()}`}>
            {statusLabel[reference.status]}
          </span>
        </div>

        <dl className="detail-summary-grid">
          <div>
            <dt>Estado efectivo</dt>
            <dd>{statusLabel[reference.status]}</dd>
          </div>
          <div>
            <dt>Versión actual</dt>
            <dd>{reference.version}</dd>
          </div>
          <div>
            <dt>Referencia externa</dt>
            <dd>{reference.externalReference ?? 'Sin referencia externa'}</dd>
          </div>
          <div>
            <dt>Monto</dt>
            <dd>{formatMoney(reference.amount, reference.currency)}</dd>
          </div>
          <div>
            <dt>Vence</dt>
            <dd>{formatDateTime(reference.dueDate)}</dd>
          </div>
          <div>
            <dt>Creada</dt>
            <dd>{formatDateTime(reference.createdAt)}</dd>
          </div>
          <div>
            <dt>Actualizada</dt>
            <dd>{formatDateTime(reference.updatedAt)}</dd>
          </div>
          <div>
            <dt>Creada por</dt>
            <dd>{reference.createdBy.username ?? reference.createdBy.id}</dd>
          </div>
        </dl>
      </section>

      {isSupervisor ? (
        <section className="card stack" aria-labelledby="reference-cancel-title">
          <div className="stack stack-sm">
            <h2 id="reference-cancel-title">Cancelación supervisada</h2>
            <p className="muted-copy">
              La cancelación exige confirmación y siempre usa la última versión visible en pantalla.
            </p>
          </div>

          {canCancel ? (
            isConfirmingCancel ? (
              <div
                className="confirm-panel stack"
                role="alertdialog"
                aria-labelledby="cancel-dialog-title"
                aria-describedby="cancel-dialog-copy"
              >
                <h3 id="cancel-dialog-title">Confirmar cancelación</h3>
                <p id="cancel-dialog-copy">
                  Vamos a cancelar la referencia usando la versión <strong>{reference.version}</strong>.
                  Si alguien cambió el estado antes, refrescaremos el detalle para que no operes sobre datos viejos.
                </p>
                <div className="detail-actions">
                  <button
                    className="primary-button"
                    disabled={isCancelling}
                    onClick={() => void handleCancelConfirmation()}
                    type="button"
                  >
                    {isCancelling ? 'Cancelando...' : 'Confirmar cancelación'}
                  </button>
                  <button
                    className="secondary-button"
                    disabled={isCancelling}
                    onClick={() => setIsConfirmingCancel(false)}
                    type="button"
                  >
                    Volver
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="primary-button"
                onClick={() => {
                  setFeedback(null);
                  setIsConfirmingCancel(true);
                }}
                type="button"
              >
                Cancelar referencia
              </button>
            )
          ) : (
            <div className="notice" role="status">
              Esta referencia ya no admite cancelación desde su estado actual.
            </div>
          )}
        </section>
      ) : null}

      <section className="card stack" aria-labelledby="reference-history-title">
        <div className="stack stack-sm">
          <h2 id="reference-history-title">Historial y auditoría</h2>
          <p className="muted-copy">
            Cada entrada muestra quién actuó, qué ocurrió y cuándo quedó registrado.
          </p>
        </div>

        <div className="history-list" role="list">
          {history.map((entry) => (
            <article className="history-item stack stack-sm" key={entry.id} role="listitem">
              <div className="workspace-results-header">
                <strong>{formatHistoryTitle(entry)}</strong>
                <span>{formatDateTime(entry.createdAt)}</span>
              </div>
              <dl className="history-meta-grid">
                <div>
                  <dt>Actor</dt>
                  <dd>{formatActor(entry)}</dd>
                </div>
                <div>
                  <dt>Correlation ID</dt>
                  <dd>{entry.correlationId ?? '—'}</dd>
                </div>
              </dl>
              {entry.metadata ? (
                <pre className="history-metadata">{JSON.stringify(entry.metadata, null, 2)}</pre>
              ) : null}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
