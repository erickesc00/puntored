import { getEffectiveReferenceLifecycleStatus } from './reference-expiration.policy';
import {
  REFERENCE_STATUS,
  type ReferenceLifecycleStatus,
} from '../value-objects/reference-status';

export interface CancellationEligibilityInput {
  currentStatus: ReferenceLifecycleStatus;
  dueAt: Date;
  currentVersion: number;
  expectedVersion: number;
  now?: Date;
}

export interface CancellationEligibilityResult {
  allowed: boolean;
  reason?: 'VERSION_MISMATCH' | 'INVALID_STATUS' | 'REFERENCE_EXPIRED';
  effectiveStatus: ReferenceLifecycleStatus;
}

export function evaluateCancellationEligibility(
  input: CancellationEligibilityInput,
): CancellationEligibilityResult {
  const effectiveStatus = getEffectiveReferenceLifecycleStatus(
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

  if (effectiveStatus === REFERENCE_STATUS.EXPIRED) {
    return {
      allowed: false,
      reason: 'REFERENCE_EXPIRED',
      effectiveStatus,
    };
  }

  if (effectiveStatus !== REFERENCE_STATUS.PENDING) {
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
