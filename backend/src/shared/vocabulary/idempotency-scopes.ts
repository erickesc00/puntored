export const IDEMPOTENCY_SCOPE = {
  REFERENCE_CREATE: 'payment-reference:create',
} as const;

export type IdempotencyScope =
  (typeof IDEMPOTENCY_SCOPE)[keyof typeof IDEMPOTENCY_SCOPE];
