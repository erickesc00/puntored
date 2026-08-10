import { apiClient } from '@/lib/api/client';
import type { components } from '@/lib/api/generated-types';
import type { CreateReferencePayload } from './validation';

export const createReference = (
  payload: CreateReferencePayload,
  idempotencyKey: string,
) =>
  apiClient.post<components['schemas']['ReferenceResponseDto']>('/references', {
    body: payload,
    headers: {
      'Idempotency-Key': idempotencyKey,
    },
  });
