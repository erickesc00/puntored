import { apiClient } from '@/lib/api/client';
import type { ReferenceDetailResponse } from '@/features/references/shared/types';

export const fetchReferenceDetail = (referenceId: string) =>
  apiClient.get<ReferenceDetailResponse>(
    `/references/${encodeURIComponent(referenceId)}`,
  );
