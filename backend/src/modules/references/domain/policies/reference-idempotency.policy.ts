import { createHash } from 'node:crypto';

export interface CreateReferenceFingerprintPayload {
  externalReference?: string;
  concept: string;
  amount: number;
  currency: string;
  dueDate: string;
}

export function normalizeExternalReference(value: string) {
  return value.trim().toUpperCase();
}

export function buildDeterministicReferenceId(
  scope: string,
  actorId: string,
  idempotencyKey: string,
) {
  const suffix = createHash('sha256')
    .update(`${scope}:${actorId}:${idempotencyKey}`)
    .digest('hex')
    .slice(0, 24);

  return `ref_${suffix}`;
}

export function normalizeConcept(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

export function normalizeCurrency(value: string) {
  return value.trim().toUpperCase();
}

export function normalizeCreateReferencePayload(
  payload: CreateReferenceFingerprintPayload,
): CreateReferenceFingerprintPayload {
  return {
    ...(payload.externalReference
      ? {
          externalReference: normalizeExternalReference(
            payload.externalReference,
          ),
        }
      : {}),
    concept: normalizeConcept(payload.concept),
    amount: payload.amount,
    currency: normalizeCurrency(payload.currency),
    dueDate: new Date(payload.dueDate).toISOString(),
  };
}

export function createIdempotencyFingerprint(
  payload: CreateReferenceFingerprintPayload,
) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
