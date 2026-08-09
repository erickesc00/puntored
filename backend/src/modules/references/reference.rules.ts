import { createHash } from 'node:crypto';
import { ReferenceStatus } from '@prisma/client';

export interface CreateReferenceFingerprintPayload {
  concept: string;
  amount: number;
  currency: string;
  dueDate: string;
}

export interface CancellationEligibilityInput {
  currentStatus: ReferenceStatus;
  dueAt: Date;
  currentVersion: number;
  expectedVersion: number;
  now?: Date;
}

export interface CancellationEligibilityResult {
  allowed: boolean;
  reason?: 'VERSION_MISMATCH' | 'INVALID_STATUS' | 'REFERENCE_EXPIRED';
  effectiveStatus: ReferenceStatus;
}

export interface ExpirationEligibilityResult {
  eligible: boolean;
  reason?: 'INVALID_STATUS' | 'NOT_OVERDUE';
}

export const REFERENCES_IDEMPOTENCY_SCOPE = 'payment-reference:create';

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

export function getEffectiveReferenceStatus(
  status: ReferenceStatus,
  dueAt: Date,
  now = new Date(),
) {
  if (canAutoExpireReference(status, dueAt, now)) {
    return ReferenceStatus.EXPIRED;
  }

  return status;
}

export function isReferenceOverdue(dueAt: Date, now = new Date()) {
  return dueAt.getTime() <= now.getTime();
}

export function canAutoExpireReference(
  status: ReferenceStatus,
  dueAt: Date,
  now = new Date(),
) {
  return status === ReferenceStatus.PENDING && isReferenceOverdue(dueAt, now);
}

export function evaluateExpirationEligibility(
  status: ReferenceStatus,
  dueAt: Date,
  now = new Date(),
): ExpirationEligibilityResult {
  if (status !== ReferenceStatus.PENDING) {
    return {
      eligible: false,
      reason: 'INVALID_STATUS',
    };
  }

  if (!isReferenceOverdue(dueAt, now)) {
    return {
      eligible: false,
      reason: 'NOT_OVERDUE',
    };
  }

  return { eligible: true };
}

export function evaluateCancellationEligibility(
  input: CancellationEligibilityInput,
): CancellationEligibilityResult {
  const effectiveStatus = getEffectiveReferenceStatus(
    input.currentStatus,
    input.dueAt,
    input.now,
  );

  if (input.expectedVersion !== input.currentVersion) {
    return {
      allowed: false,
      reason: 'VERSION_MISMATCH',
      effectiveStatus,
    };
  }

  if (effectiveStatus === ReferenceStatus.EXPIRED) {
    return {
      allowed: false,
      reason: 'REFERENCE_EXPIRED',
      effectiveStatus,
    };
  }

  if (effectiveStatus !== ReferenceStatus.PENDING) {
    return {
      allowed: false,
      reason: 'INVALID_STATUS',
      effectiveStatus,
    };
  }

  return {
    allowed: true,
    effectiveStatus,
  };
}
