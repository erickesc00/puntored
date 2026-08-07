import { apiClient } from '@/lib/api/client';
import type { ReferenceSummary } from '@/features/references/shared/types';

export const cancelReference = (referenceId: string, version: number) =>
  apiClient.post<ReferenceSummary>(
    `/references/${encodeURIComponent(referenceId)}/cancel`,
    {
      body: { version },
    },
  );
