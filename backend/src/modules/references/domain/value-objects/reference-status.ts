export const REFERENCE_STATUS = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
} as const;

export type ReferenceLifecycleStatus =
  (typeof REFERENCE_STATUS)[keyof typeof REFERENCE_STATUS];
