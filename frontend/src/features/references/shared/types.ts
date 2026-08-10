import type { components } from '@/lib/api/generated-types';

export type ReferenceStatus =
  components['schemas']['ReferenceResponseDto']['status'];

export const REFERENCE_STATUSES: readonly ReferenceStatus[] = [
  'PENDING',
  'PAID',
  'CANCELLED',
  'EXPIRED',
];

export type ReferenceSummary = components['schemas']['ReferenceResponseDto'];

export type ReferenceListResponse =
  components['schemas']['ListReferencesResponseDto'];

export type ReferenceAuditEntry =
  components['schemas']['ReferenceHistoryResponseDto'];

export type ReferenceDetailResponse =
  components['schemas']['ReferenceDetailResponseDto'];
