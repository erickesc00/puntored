import { apiClient } from '@/lib/api/client';
import type { ReferenceListResponse } from '@/features/references/shared/types';
import {
  buildReferenceListApiSearchParams,
  type ReferenceListUrlState,
} from './query-state';

export const fetchReferenceList = async (state: ReferenceListUrlState) => {
  const query = buildReferenceListApiSearchParams(state).toString();
  const path = query.length > 0 ? `/references?${query}` : '/references';

  return apiClient.get<ReferenceListResponse>(path);
};
