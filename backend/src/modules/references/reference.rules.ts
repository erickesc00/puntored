import { ReferenceStatus } from '@prisma/client';
import {
  type CancellationEligibilityInput,
  type CancellationEligibilityResult,
  evaluateCancellationEligibility as evaluateCancellationPolicy,
} from './domain/policies/reference-cancellation.policy';
import {
  buildDeterministicReferenceId,
  createIdempotencyFingerprint,
  normalizeConcept,
  normalizeCreateReferencePayload,
  normalizeCurrency,
  type CreateReferenceFingerprintPayload,
} from './domain/policies/reference-idempotency.policy';
import {
  canAutoExpireReference as canAutoExpirePolicy,
  evaluateExpirationEligibility as evaluateExpirationPolicy,
  getEffectiveReferenceLifecycleStatus,
  isReferenceOverdue,
  type ExpirationEligibilityResult,
} from './domain/policies/reference-expiration.policy';
import { REFERENCES_IDEMPOTENCY_SCOPE } from './domain/references.constants';

export {
  buildDeterministicReferenceId,
  createIdempotencyFingerprint,
  isReferenceOverdue,
  normalizeConcept,
  normalizeCreateReferencePayload,
  normalizeCurrency,
  REFERENCES_IDEMPOTENCY_SCOPE,
};
export type {
  CancellationEligibilityInput,
  CancellationEligibilityResult,
  CreateReferenceFingerprintPayload,
  ExpirationEligibilityResult,
};

export function getEffectiveReferenceStatus(
  status: ReferenceStatus,
  dueAt: Date,
  now = new Date(),
): ReferenceStatus {
  return getEffectiveReferenceLifecycleStatus(status, dueAt, now);
}

export function canAutoExpireReference(
  status: ReferenceStatus,
  dueAt: Date,
  now = new Date(),
) {
  return canAutoExpirePolicy(status, dueAt, now);
}

export function evaluateExpirationEligibility(
  status: ReferenceStatus,
  dueAt: Date,
  now = new Date(),
): ExpirationEligibilityResult {
  return evaluateExpirationPolicy(status, dueAt, now);
}

export function evaluateCancellationEligibility(
  input: CancellationEligibilityInput,
): CancellationEligibilityResult {
  return {
    ...evaluateCancellationPolicy(input),
    effectiveStatus: getEffectiveReferenceStatus(
      input.currentStatus,
      input.dueAt,
      input.now,
    ),
  };
}
