import {
  REFERENCE_STATUS,
  type ReferenceLifecycleStatus,
} from '../value-objects/reference-status';

export interface ExpirationEligibilityResult {
  eligible: boolean;
  reason?: 'INVALID_STATUS' | 'NOT_OVERDUE';
}

export function getEffectiveReferenceLifecycleStatus(
  status: ReferenceLifecycleStatus,
  dueAt: Date,
  now = new Date(),
) {
  if (canAutoExpireReference(status, dueAt, now)) {
    return REFERENCE_STATUS.EXPIRED;
  }

  return status;
}

export function isReferenceOverdue(dueAt: Date, now = new Date()) {
  return dueAt.getTime() <= now.getTime();
}

export function canAutoExpireReference(
  status: ReferenceLifecycleStatus,
  dueAt: Date,
  now = new Date(),
) {
  return status === REFERENCE_STATUS.PENDING && isReferenceOverdue(dueAt, now);
}

export function evaluateExpirationEligibility(
  status: ReferenceLifecycleStatus,
  dueAt: Date,
  now = new Date(),
): ExpirationEligibilityResult {
  if (status !== REFERENCE_STATUS.PENDING) {
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
