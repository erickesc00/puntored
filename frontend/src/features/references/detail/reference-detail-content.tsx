import Link from "next/link";
import { FeedbackBanner } from "@/components/feedback-banner";
import { formatDateTime, formatMoney, statusLabel } from "@/features/references/shared/presentation";
import type { ReferenceDetailController } from "./use-reference-detail-controller";
import { formatActor, formatHistoryTitle } from "./reference-detail-presentation";

export function ReferenceDetailContent({
  controller,
}: {
  controller: ReferenceDetailController;
}) {
  const {
    canCancel,
    cancelDialogRef,
    cancelDialogDismissButtonRef,
    cancelTriggerButtonRef,
    closeCancelConfirmation,
    confirmCancel,
    detail,
    errorMessage,
    feedback,
    isCancelling,
    isConfirmingCancel,
    isLoading,
    isNotFound,
    isSupervisor,
    onCancelDialogKeyDown,
    openCancelConfirmation,
    reload,
    returnTo,
  } = controller;

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
            <button className="secondary-button" onClick={() => void reload()} type="button">
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
            {errorMessage ??
              "No pudimos cargar el detalle de la referencia. Inténtalo de nuevo."}
          </div>
          <div className="detail-actions">
            <Link className="text-link" href={returnTo}>
              Volver al listado
            </Link>
            <button className="secondary-button" onClick={() => void reload()} type="button">
              Reintentar
            </button>
          </div>
        </section>
      </main>
    );
  }

  const { history, reference } = detail;

  return (
    <main className="detail-page-shell stack">
      <div className="page-back-link-row">
        <Link className="back-link" href={returnTo}>
          <BackIcon />
          <span>Volver</span>
        </Link>
      </div>

      <section className="workspace-heading detail-heading">
        <div className="stack stack-sm page-heading-copy">
          <p className="eyebrow">Detalle</p>
          <h1>{reference.concept}</h1>
          <p className="workspace-copy">
            Revisa el estado efectivo, la versión actual y la auditoría asociada a la referencia.
          </p>
        </div>

        {isSupervisor ? (
          <div className="detail-heading-actions">
            <button
              className="detail-inline-danger-button"
              disabled={!canCancel || isConfirmingCancel || isCancelling}
              onClick={openCancelConfirmation}
              ref={cancelTriggerButtonRef}
              type="button"
            >
              {isCancelling ? "Cancelando..." : "Cancelar referencia"}
            </button>
          </div>
        ) : null}
      </section>

      {feedback ? (
        <FeedbackBanner tone={feedback.tone}>
          {feedback.message}
        </FeedbackBanner>
      ) : null}

      {errorMessage ? (
        <FeedbackBanner tone="error">
          {errorMessage}
        </FeedbackBanner>
      ) : null}

      {isSupervisor && isConfirmingCancel ? (
        <div className="detail-confirm-overlay" role="presentation">
          <div
            ref={cancelDialogRef}
            className="confirm-panel detail-confirm-dialog stack"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="cancel-dialog-title"
            aria-describedby="cancel-dialog-copy"
            onKeyDown={onCancelDialogKeyDown}
          >
            <div className="detail-confirm-dialog-header">
              <div className="detail-confirm-icon" aria-hidden="true">
                <WarningIcon />
              </div>
              <div className="stack stack-sm detail-confirm-copy">
                <h2 id="cancel-dialog-title">Cancelar referencia de pago</h2>
                <p id="cancel-dialog-copy">
                  Esta acción inhabilitará permanentemente la referencia. ¿Estás seguro de continuar?
                </p>
              </div>
            </div>
            <div className="detail-actions detail-confirm-actions">
              <button
                ref={cancelDialogDismissButtonRef}
                className="secondary-button secondary-button-outline"
                disabled={isCancelling}
                onClick={closeCancelConfirmation}
                type="button"
              >
                Volver
              </button>
              <button
                className="primary-button"
                disabled={isCancelling}
                onClick={() => void confirmCancel()}
                type="button"
              >
                {isCancelling ? "Cancelando..." : "Confirmar cancelación"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="detail-layout">
        <div className="detail-column stack">
          <section className="card stack" aria-labelledby="reference-summary-title">
            <div className="workspace-results-header">
              <h2 id="reference-summary-title">Resumen de referencia</h2>
              <span className={`status-pill status-${reference.status.toLowerCase()}`}>
                {statusLabel(reference.status)}
              </span>
            </div>

            <dl className="detail-summary-list">
              <div>
                <dt>Referencia externa</dt>
                <dd>{reference.externalReference ?? "Sin referencia externa"}</dd>
              </div>
              <div>
                <dt>Monto</dt>
                <dd>{formatMoney(reference.amount, reference.currency)}</dd>
              </div>
              <div>
                <dt>Fecha de vencimiento</dt>
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
        </div>

        <section className="card stack history-card" aria-labelledby="reference-history-title">
          <div className="stack stack-sm">
            <h2 id="reference-history-title">Historial y auditoría</h2>
          </div>

          <div className="history-list" role="list">
            {history.map((entry) => (
              <article className="history-item" key={entry.id} role="listitem">
                <span className="history-dot" aria-hidden="true" />
                <div className="history-item-copy">
                  <div className="history-item-title-row">
                    <strong>{formatHistoryTitle(entry)}</strong>
                    <span className="history-timestamp">{formatDateTime(entry.createdAt)}</span>
                  </div>
                  <div className="history-item-meta-row">
                    <span>{formatActor(entry)}</span>
                    <span className="history-meta-separator" aria-hidden="true">
                      •
                    </span>
                    <span>Correlation ID: {entry.correlationId ?? "—"}</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        d="M10.78 5.47a.75.75 0 0 1 0 1.06L6.31 11h11.94a.75.75 0 0 1 0 1.5H6.31l4.47 4.47a.75.75 0 1 1-1.06 1.06l-5.75-5.75a.75.75 0 0 1 0-1.06l5.75-5.75a.75.75 0 0 1 1.06 0Z"
        fill="currentColor"
      />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        d="M12 3.75c.4 0 .77.21.98.56l7.5 12.75a1.13 1.13 0 0 1-.98 1.69H4.5a1.13 1.13 0 0 1-.98-1.69l7.5-12.75c.21-.35.58-.56.98-.56Zm0 4.5a.75.75 0 0 0-.75.75v4.5a.75.75 0 0 0 1.5 0V9a.75.75 0 0 0-.75-.75Zm0 8.63a.94.94 0 1 0 0-1.88.94.94 0 0 0 0 1.88Z"
        fill="currentColor"
      />
    </svg>
  );
}
