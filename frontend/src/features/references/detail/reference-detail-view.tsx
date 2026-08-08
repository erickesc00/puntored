"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cancelReference } from "@/features/references/cancel/api";
import type {
  ReferenceAuditEntry,
  ReferenceDetailResponse,
  ReferenceSummary,
} from "@/features/references/shared/types";
import { ApiClientError } from "@/lib/api/errors";
import { useSession } from "@/lib/session/session-provider";
import { fetchReferenceDetail } from "./api";

type FeedbackTone = "error" | "status";

interface FeedbackState {
  message: string;
  tone: FeedbackTone;
}

const DEFAULT_RETURN_TO = "/references";

const statusLabel: Record<string, string> = {
  PENDING: "Pendiente",
  PAID: "Pagada",
  CANCELLED: "Cancelada",
  EXPIRED: "Expirada",
};

const cancelConflictCodes = new Set([
  "REFERENCE_VERSION_CONFLICT",
  "INVALID_REFERENCE_STATE",
  "REFERENCE_EXPIRED",
]);

const sanitizeReturnTo = (value: string | null) => {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return DEFAULT_RETURN_TO;
  }

  return value;
};

const formatMoney = (amount: number, currency: string) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount / 100);

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("es-AR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const canCancelReference = (reference: ReferenceSummary) =>
  reference.status === "PENDING";

const formatHistoryTitle = (entry: ReferenceAuditEntry) =>
  `${entry.action.replaceAll("_", " ")} · ${entry.result.replaceAll("_", " ")}`;

const formatActor = (entry: ReferenceAuditEntry) => {
  if (!entry.actorId) {
    return entry.actorType;
  }

  return `${entry.actorType} · ${entry.actorId}`;
};

const detailErrorMessage = (error: ApiClientError) => {
  if (error.code === "REFERENCE_NOT_FOUND") {
    return "La referencia que buscas ya no existe o no está disponible.";
  }

  return "No pudimos cargar el detalle de la referencia. Inténtalo de nuevo.";
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
  const cancelDialogDismissButtonRef = useRef<HTMLButtonElement | null>(null);

  const currentUrl = useMemo(() => {
    const query = searchParams.toString();
    return query.length > 0 ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);

  const returnTo = useMemo(
    () => sanitizeReturnTo(searchParams.get("returnTo")),
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
          (error.statusCode === 404 || error.code === "REFERENCE_NOT_FOUND")
        ) {
          setIsNotFound(true);
          return;
        }

        setErrorMessage(
          error instanceof ApiClientError
            ? detailErrorMessage(error)
            : "No pudimos cargar el detalle de la referencia. Inténtalo de nuevo.",
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

  useEffect(() => {
    if (!isConfirmingCancel) {
      return;
    }

    cancelDialogDismissButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isCancelling) {
        setIsConfirmingCancel(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isCancelling, isConfirmingCancel]);

  const isSupervisor = user?.role?.toUpperCase() === "SUPERVISOR";
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
        tone: "status",
        message:
          "Referencia cancelada correctamente. Refrescamos el detalle con la última versión.",
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
          tone: "status",
          message:
            "La referencia cambió antes de completar la cancelación. Ya refrescamos el detalle con la última versión.",
        });
        return;
      }

      setFeedback({
        tone: "error",
        message:
          error instanceof ApiClientError
            ? "No pudimos cancelar la referencia. Inténtalo de nuevo."
            : "No pudimos cancelar la referencia. Inténtalo de nuevo.",
      });
    } finally {
      setIsCancelling(false);
    }
  };

  if (isLoading && !detail && !errorMessage && !isNotFound) {
    return (
      <main className="detail-page-shell">
        <section
          className="card stack"
          aria-busy="true"
          aria-labelledby="detail-loading-title"
        >
          <h1 id="detail-loading-title">Cargando detalle...</h1>
          <p role="status">Estamos trayendo la referencia y su historial.</p>
        </section>
      </main>
    );
  }

  if (isNotFound) {
    return (
      <main className="detail-page-shell">
        <section
          className="card stack"
          aria-labelledby="detail-not-found-title"
        >
          <p className="eyebrow">Detalle</p>
          <h1 id="detail-not-found-title">Referencia no encontrada</h1>
          <p className="muted-copy">
            La referencia que abriste ya no existe o cambió antes de que
            pudieras verla.
          </p>
          <div className="detail-actions">
            <Link className="text-link" href={returnTo}>
              Volver al listado
            </Link>
            <button
              className="secondary-button"
              onClick={() => void loadDetail()}
              type="button"
            >
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
            <button
              className="secondary-button"
              onClick={() => void loadDetail()}
              type="button"
            >
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
            Revisa el estado efectivo, la versión actual y la auditoría asociada
            a la referencia.
          </p>
        </div>

        {isSupervisor ? (
          <div className="detail-heading-actions">
            <button
              className="detail-inline-danger-button"
              disabled={!canCancel || isConfirmingCancel || isCancelling}
              onClick={() => {
                setFeedback(null);
                setIsConfirmingCancel(true);
              }}
              type="button"
            >
              {isCancelling ? "Cancelando..." : "Cancelar referencia"}
            </button>
          </div>
        ) : null}
      </section>

      {feedback ? (
        <div
          className={
            feedback.tone === "error" ? "error-banner" : "status-banner"
          }
          role={feedback.tone === "error" ? "alert" : "status"}
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

      {isSupervisor && isConfirmingCancel ? (
        <div className="detail-confirm-overlay" role="presentation">
          <div
            className="confirm-panel detail-confirm-dialog stack"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="cancel-dialog-title"
            aria-describedby="cancel-dialog-copy"
          >
            <div className="detail-confirm-dialog-header">
              <div className="detail-confirm-icon" aria-hidden="true">
                <WarningIcon />
              </div>
              <div className="stack stack-sm detail-confirm-copy">
                <h2 id="cancel-dialog-title">Cancelar referencia de pago</h2>
                <p id="cancel-dialog-copy">
                  Esta acción inhabilitará permanentemente la referencia. ¿Estás
                  seguro de continuar?
                </p>
              </div>
            </div>
            <div className="detail-actions detail-confirm-actions">
              <button
                ref={cancelDialogDismissButtonRef}
                className="secondary-button secondary-button-outline"
                disabled={isCancelling}
                onClick={() => setIsConfirmingCancel(false)}
                type="button"
              >
                Volver
              </button>
              <button
                className="primary-button"
                disabled={isCancelling}
                onClick={() => void handleCancelConfirmation()}
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
          <section
            className="card stack"
            aria-labelledby="reference-summary-title"
          >
            <div className="workspace-results-header">
              <h2 id="reference-summary-title">Resumen de referencia</h2>
              <span
                className={`status-pill status-${reference.status.toLowerCase()}`}
              >
                {statusLabel[reference.status]}
              </span>
            </div>

            <dl className="detail-summary-list">
              <div>
                <dt>Referencia externa</dt>
                <dd>
                  {reference.externalReference ?? "Sin referencia externa"}
                </dd>
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
                <dd>
                  {reference.createdBy.username ?? reference.createdBy.id}
                </dd>
              </div>
            </dl>
          </section>
        </div>

        <section
          className="card stack history-card"
          aria-labelledby="reference-history-title"
        >
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
                    <span className="history-timestamp">
                      {formatDateTime(entry.createdAt)}
                    </span>
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
