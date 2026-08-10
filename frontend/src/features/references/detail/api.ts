import { apiClient } from '@/lib/api/client';
import type { components } from '@/lib/api/generated-types';

export const fetchReferenceDetail = (referenceId: string) =>
  apiClient.get<components['schemas']['ReferenceDetailResponseDto']>(
    `/references/${encodeURIComponent(referenceId)}`,
  );
