import { apiClient } from '@/lib/api/client';
import type { components } from '@/lib/api/generated-types';

export const cancelReference = (referenceId: string, version: number) =>
  apiClient.post<components['schemas']['ReferenceResponseDto']>(
    `/references/${encodeURIComponent(referenceId)}/cancel`,
    {
      body: { version },
    },
  );
