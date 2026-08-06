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

export const REFERENCES_IDEMPOTENCY_SCOPE = 'payment-reference:create';

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
  if (status === ReferenceStatus.PENDING && dueAt.getTime() <= now.getTime()) {
    return ReferenceStatus.EXPIRED;
  }

  return status;
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
