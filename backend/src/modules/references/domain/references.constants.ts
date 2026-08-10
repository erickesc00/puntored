import { AUDIT_ACTION } from '../../../shared/vocabulary/audit-actions';
import { IDEMPOTENCY_SCOPE } from '../../../shared/vocabulary/idempotency-scopes';

export const REFERENCES_IDEMPOTENCY_SCOPE = IDEMPOTENCY_SCOPE.REFERENCE_CREATE;

export const REFERENCE_CREATE_IDEMPOTENCY_TTL_HOURS = 72;

export const REFERENCE_AUDIT_ACTION = {
  CREATE: AUDIT_ACTION.CREATE_REFERENCE,
  IDEMPOTENT_REPLAY: AUDIT_ACTION.IDEMPOTENT_REPLAY,
  CANCEL_ATTEMPT: AUDIT_ACTION.CANCEL_ATTEMPT,
  CANCEL: AUDIT_ACTION.CANCEL_REFERENCE,
} as const;

export const REFERENCE_CREATE_OUTCOME = {
  SUCCESS: 'success',
  REJECTED_MISSING_IDEMPOTENCY_KEY: 'rejected_missing_idempotency_key',
  REJECTED_INVALID_DUE_DATE: 'rejected_invalid_due_date',
  REJECTED_PROVIDER_ALLOCATION_FAILED: 'rejected_provider_allocation_failed',
  REJECTED_IDEMPOTENCY_CONFLICT: 'rejected_idempotency_conflict',
  REJECTED_UNRESOLVABLE_REPLAY: 'rejected_unresolvable_replay',
} as const;

export type ReferenceCreateOutcome =
  (typeof REFERENCE_CREATE_OUTCOME)[keyof typeof REFERENCE_CREATE_OUTCOME];

export const REFERENCE_CANCEL_OUTCOME = {
  SUCCESS: 'success',
  REJECTED_NOT_FOUND: 'rejected_not_found',
  REJECTED_VERSION_CONFLICT: 'rejected_version_conflict',
  REJECTED_EXPIRED: 'rejected_expired',
  REJECTED_INVALID_STATE: 'rejected_invalid_state',
} as const;

export type ReferenceCancelOutcome =
  (typeof REFERENCE_CANCEL_OUTCOME)[keyof typeof REFERENCE_CANCEL_OUTCOME];
