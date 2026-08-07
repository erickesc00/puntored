'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiClientError } from '@/lib/api/errors';
import { useSession } from '@/lib/session/session-provider';
import { createReference } from './api';
import {
  buildCreateReferenceFingerprint,
  resolveIdempotencyIntent,
  type IdempotencyIntent,
} from './idempotency-intent';
import {
  validateCreateReference,
  type CreateReferenceFormValues,
} from './validation';

const defaultValues = (): CreateReferenceFormValues => ({
  concept: '',
  amount: '',
  currency: 'COP',
  dueDate: '',
});

const errorMessageByCode: Record<string, string> = {
  IDEMPOTENCY_CONFLICT:
    'Ya existe un intento con esa clave para otro payload. Reiniciá el formulario para generar una intención nueva.',
  INVALID_DUE_DATE: 'La fecha de vencimiento debe estar en el futuro.',
};

export function CreateReferenceForm() {
  const router = useRouter();
  const { handleSessionError } = useSession();
  const [values, setValues] = useState<CreateReferenceFormValues>(defaultValues);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof CreateReferenceFormValues, string>>>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [intent, setIntent] = useState<IdempotencyIntent | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetForm = () => {
    setValues(defaultValues());
    setFieldErrors({});
    setFeedback(null);
    setIntent(null);
  };

  return (
    <main className="create-page-shell">
      <div className="page-back-link-row">
        <Link className="back-link" href="/references">
          <BackIcon />
          <span>Volver</span>
        </Link>
      </div>

      <section className="create-page-intro stack stack-sm" aria-labelledby="create-reference-title">
        <p className="eyebrow">Nueva referencia</p>
        <h1 id="create-reference-title">Crear referencia de pago</h1>
      </section>

      <section className="card stack create-card" aria-labelledby="create-reference-title">
        <div className="stack stack-sm">
          <p className="muted-copy">
            Completá los datos para generar una nueva referencia de pago.
          </p>
        </div>

        {feedback ? (
          <div className="error-banner" role="alert" aria-live="polite">
            {feedback}
          </div>
        ) : null}

        {intent ? (
          <div className="notice" role="status" aria-live="polite">
            Si reintentás este envío sin cambiar la intención, vamos a reutilizar la
            misma protección contra duplicados.
          </div>
        ) : null}

        <form
          className="form-stack"
          onSubmit={async (event) => {
            event.preventDefault();
            setFeedback(null);

            const validation = validateCreateReference(values);
            setFieldErrors(validation.errors);

            if (!validation.payload) {
              return;
            }

            const fingerprint = buildCreateReferenceFingerprint(validation.payload);
            const nextIntent = resolveIdempotencyIntent(intent, fingerprint);
            setIntent(nextIntent);
            setIsSubmitting(true);

            try {
              const response = await createReference(
                validation.payload,
                nextIntent.key,
              );

              setIntent(null);
              router.push(`/references?created=${response.id}`);
            } catch (error) {
              if (handleSessionError(error, '/references/new')) {
                return;
              }

              if (error instanceof ApiClientError) {
                setFeedback(
                  errorMessageByCode[error.code] ??
                    'No pudimos crear la referencia. Revisá los datos o reintentá.',
                );
              } else {
                setFeedback('No pudimos crear la referencia. Revisá los datos o reintentá.');
              }
            } finally {
              setIsSubmitting(false);
            }
          }}
        >
          <label className="field" htmlFor="concept">
            <span>Concepto de Recaudo</span>
            <input
              aria-describedby={fieldErrors.concept ? 'concept-error' : undefined}
              aria-invalid={Boolean(fieldErrors.concept)}
              id="concept"
              name="concept"
              onChange={(event) =>
                setValues((current) => ({ ...current, concept: event.target.value }))
              }
              placeholder="Ej. Matrícula agosto"
              value={values.concept}
            />
            {!fieldErrors.concept ? (
              <span className="field-hint">Este nombre será visible en el detalle y en el listado de referencias.</span>
            ) : null}
            {fieldErrors.concept ? (
              <span className="field-error" id="concept-error">
                {fieldErrors.concept}
              </span>
            ) : null}
          </label>

          <div className="form-grid-two-columns">
            <label className="field" htmlFor="amount">
              <span>Monto</span>
              <input
                aria-describedby={fieldErrors.amount ? 'amount-error' : undefined}
                aria-invalid={Boolean(fieldErrors.amount)}
                id="amount"
                inputMode="decimal"
                name="amount"
                onChange={(event) =>
                  setValues((current) => ({ ...current, amount: event.target.value }))
                }
                placeholder="1250.50"
                value={values.amount}
              />
              {fieldErrors.amount ? (
                <span className="field-error" id="amount-error">
                  {fieldErrors.amount}
                </span>
              ) : null}
            </label>

            <label className="field" htmlFor="currency">
              <span>Moneda</span>
              <select
                aria-describedby={fieldErrors.currency ? 'currency-error' : undefined}
                aria-invalid={Boolean(fieldErrors.currency)}
                id="currency"
                name="currency"
                onChange={(event) =>
                  setValues((current) => ({ ...current, currency: event.target.value.toUpperCase() }))
                }
                value={values.currency}
              >
                <option value="COP">COP</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
              {fieldErrors.currency ? (
                <span className="field-error" id="currency-error">
                  {fieldErrors.currency}
                </span>
              ) : null}
            </label>
          </div>

          <label className="field" htmlFor="dueDate">
            <span>Fecha de Vencimiento</span>
            <input
              aria-describedby={fieldErrors.dueDate ? 'dueDate-error' : undefined}
              aria-invalid={Boolean(fieldErrors.dueDate)}
              id="dueDate"
              name="dueDate"
              onChange={(event) =>
                setValues((current) => ({ ...current, dueDate: event.target.value }))
              }
              type="datetime-local"
              value={values.dueDate}
            />
            {fieldErrors.dueDate ? (
              <span className="field-error" id="dueDate-error">
                {fieldErrors.dueDate}
              </span>
            ) : null}
          </label>

          <div className="form-actions-row create-form-actions">
            <button className="primary-button create-submit-button" disabled={isSubmitting} type="submit">
              {isSubmitting ? 'Creando...' : 'Crear referencia'}
            </button>
            <button className="secondary-button secondary-button-outline" disabled={isSubmitting} onClick={resetForm} type="button">
              Reiniciar intento
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M10.78 5.47a.75.75 0 0 1 0 1.06L6.31 11h11.94a.75.75 0 0 1 0 1.5H6.31l4.47 4.47a.75.75 0 1 1-1.06 1.06l-5.75-5.75a.75.75 0 0 1 0-1.06l5.75-5.75a.75.75 0 0 1 1.06 0Z" fill="currentColor" />
    </svg>
  );
}
