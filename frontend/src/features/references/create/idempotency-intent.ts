import type { CreateReferencePayload } from './validation';

export interface IdempotencyIntent {
  key: string;
  fingerprint: string;
}

export const buildCreateReferenceFingerprint = (
  payload: CreateReferencePayload,
) =>
  JSON.stringify({
    concept: payload.concept,
    amount: payload.amount,
    currency: payload.currency,
    dueDate: payload.dueDate,
  });

export const resolveIdempotencyIntent = (
  current: IdempotencyIntent | null,
  fingerprint: string,
  createKey: () => string = () => globalThis.crypto.randomUUID(),
): IdempotencyIntent => {
  if (current?.fingerprint === fingerprint) {
    return current;
  }

  return {
    key: createKey(),
    fingerprint,
  };
};
