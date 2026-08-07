import { apiClient } from '@/lib/api/client';
import type { ReferenceSummary } from '@/features/references/shared/types';
import type { CreateReferencePayload } from './validation';

export const createReference = (
  payload: CreateReferencePayload,
  idempotencyKey: string,
) =>
  apiClient.post<ReferenceSummary>('/references', {
    body: payload,
    headers: {
      'Idempotency-Key': idempotencyKey,
    },
  });
