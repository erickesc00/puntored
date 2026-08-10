'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { FeedbackTone } from '@/components/feedback-banner';
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
  currency: 'MXN',
  dueDate: '',
});

const errorMessageByCode: Record<string, string> = {
  IDEMPOTENCY_CONFLICT:
    'Ya existe un intento con esa clave para otro payload. Reinicia el formulario para generar una intención nueva.',
  INVALID_DUE_DATE: 'La fecha de vencimiento debe estar en el futuro.',
};

const defaultFeedbackMessage =
  'No pudimos crear la referencia. Revisa los datos o inténtalo de nuevo.';

export interface CreateReferenceFormController {
  feedback: { message: string; tone: FeedbackTone } | null;
  fieldErrors: Partial<Record<keyof CreateReferenceFormValues, string>>;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  intent: IdempotencyIntent | null;
  isSubmitting: boolean;
  setAmount: (value: string) => void;
  setConcept: (value: string) => void;
  setCurrency: (value: string) => void;
  setDueDate: (value: string) => void;
  values: CreateReferenceFormValues;
}

export const useCreateReferenceFormController = (): CreateReferenceFormController => {
  const router = useRouter();
  const { handleSessionError } = useSession();
  const [values, setValues] = useState<CreateReferenceFormValues>(defaultValues);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof CreateReferenceFormValues, string>>
  >({});
  const [feedback, setFeedback] = useState<{
    message: string;
    tone: FeedbackTone;
  } | null>(null);
  const [intent, setIntent] = useState<IdempotencyIntent | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  return {
    feedback,
    fieldErrors,
    handleSubmit: async (event) => {
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
        const response = await createReference(validation.payload, nextIntent.key);

        setIntent(null);
        router.push(`/references?created=${response.id}`);
      } catch (error) {
        if (handleSessionError(error, '/references/new')) {
          return;
        }

        if (error instanceof ApiClientError) {
          if (error.code === 'IDEMPOTENCY_CONFLICT') {
            setIntent(null);
            setFeedback({
              tone: 'notice',
              message:
                'Detectamos un conflicto con la protección contra duplicados. Ya preparamos un intento nuevo para que revises los datos y vuelvas a enviarlos.',
            });
            return;
          }

          setFeedback({
            tone: 'error',
            message: errorMessageByCode[error.code] ?? defaultFeedbackMessage,
          });
        } else {
          setFeedback({
            tone: 'error',
            message: defaultFeedbackMessage,
          });
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    intent,
    isSubmitting,
    setAmount: (value) => {
      setFeedback(null);
      setValues((current) => ({ ...current, amount: value }));
    },
    setConcept: (value) => {
      setFeedback(null);
      setValues((current) => ({ ...current, concept: value }));
    },
    setCurrency: (value) => {
      setFeedback(null);
      setValues((current) => ({ ...current, currency: value.toUpperCase() }));
    },
    setDueDate: (value) => {
      setFeedback(null);
      setValues((current) => ({ ...current, dueDate: value }));
    },
    values,
  };
};
