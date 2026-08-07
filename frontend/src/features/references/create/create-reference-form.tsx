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
      <section className="card stack create-card" aria-labelledby="create-reference-title">
        <div className="stack stack-sm">
          <p className="eyebrow">Nueva referencia</p>
          <h1 id="create-reference-title">Crear referencia de pago</h1>
          <p className="muted-copy">
            Validamos antes de enviar, convertimos el monto a unidades menores y
            reutilizamos la misma clave de idempotencia mientras el intento siga
            siendo el mismo.
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
            <span>Concepto</span>
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
              <input
                aria-describedby={fieldErrors.currency ? 'currency-error' : undefined}
                aria-invalid={Boolean(fieldErrors.currency)}
                id="currency"
                maxLength={3}
                name="currency"
                onChange={(event) =>
                  setValues((current) => ({ ...current, currency: event.target.value.toUpperCase() }))
                }
                placeholder="COP"
                value={values.currency}
              />
              {fieldErrors.currency ? (
                <span className="field-error" id="currency-error">
                  {fieldErrors.currency}
                </span>
              ) : null}
            </label>
          </div>

          <label className="field" htmlFor="dueDate">
            <span>Vencimiento</span>
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

          <div className="form-actions-row">
            <button className="primary-button" disabled={isSubmitting} type="submit">
              {isSubmitting ? 'Creando...' : 'Crear referencia'}
            </button>
            <button className="secondary-button" disabled={isSubmitting} onClick={resetForm} type="button">
              Reiniciar intento
            </button>
            <Link className="text-link" href="/references">
              Volver al listado
            </Link>
          </div>
        </form>
      </section>
    </main>
  );
}
