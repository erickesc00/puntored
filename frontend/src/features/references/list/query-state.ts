import {
  REFERENCE_STATUSES,
  type ReferenceStatus,
} from '@/features/references/shared/types';

export const DEFAULT_REFERENCE_PAGE_SIZE = 10;

export interface ReferenceListUrlState {
  search: string;
  status: ReferenceStatus | null;
  createdFrom: string;
  createdTo: string;
  limit: number;
  cursor: string | null;
  trail: string[];
}

const STATUS_SET = new Set<string>(REFERENCE_STATUSES);

const clampLimit = (value: string | null) => {
  const parsed = Number.parseInt(value ?? '', 10);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_REFERENCE_PAGE_SIZE;
  }

  return Math.min(100, Math.max(1, parsed));
};

const sanitizeDateInput = (value: string | null) => {
  if (!value) {
    return '';
  }

  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
};

const parseTrail = (value: string | null) =>
  (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

export const parseReferenceListUrlState = (
  searchParams: URLSearchParams,
): ReferenceListUrlState => {
  const status = searchParams.get('status');

  return {
    search: searchParams.get('search')?.trim() ?? '',
    status: status && STATUS_SET.has(status) ? (status as ReferenceStatus) : null,
    createdFrom: sanitizeDateInput(searchParams.get('createdFrom')),
    createdTo: sanitizeDateInput(searchParams.get('createdTo')),
    limit: clampLimit(searchParams.get('limit')),
    cursor: searchParams.get('cursor')?.trim() || null,
    trail: parseTrail(searchParams.get('trail')),
  };
};

export const buildReferenceListSearchParams = (
  state: ReferenceListUrlState,
) => {
  const params = new URLSearchParams();

  if (state.search) {
    params.set('search', state.search);
  }

  if (state.status) {
    params.set('status', state.status);
  }

  if (state.createdFrom) {
    params.set('createdFrom', state.createdFrom);
  }

  if (state.createdTo) {
    params.set('createdTo', state.createdTo);
  }

  if (state.limit !== DEFAULT_REFERENCE_PAGE_SIZE) {
    params.set('limit', String(state.limit));
  }

  if (state.cursor) {
    params.set('cursor', state.cursor);
  }

  if (state.trail.length > 0) {
    params.set('trail', state.trail.join(','));
  }

  return params;
};

const toUtcBoundary = (value: string, boundary: 'start' | 'end') =>
  new Date(
    `${value}T${boundary === 'start' ? '00:00:00.000' : '23:59:59.999'}Z`,
  ).toISOString();

export const buildReferenceListApiSearchParams = (
  state: ReferenceListUrlState,
) => {
  const params = new URLSearchParams();

  if (state.search) {
    params.set('search', state.search);
  }

  if (state.status) {
    params.set('status', state.status);
  }

  if (state.createdFrom) {
    params.set('createdFrom', toUtcBoundary(state.createdFrom, 'start'));
  }

  if (state.createdTo) {
    params.set('createdTo', toUtcBoundary(state.createdTo, 'end'));
  }

  params.set('limit', String(state.limit));

  if (state.cursor) {
    params.set('cursor', state.cursor);
  }

  return params;
};

export const createInitialReferenceListState = (): ReferenceListUrlState => ({
  search: '',
  status: null,
  createdFrom: '',
  createdTo: '',
  limit: DEFAULT_REFERENCE_PAGE_SIZE,
  cursor: null,
  trail: [],
});

export const getReferenceListPage = (state: ReferenceListUrlState) =>
  state.cursor ? state.trail.length + 2 : 1;

export const getNextReferenceListState = (
  state: ReferenceListUrlState,
  nextCursor: string,
): ReferenceListUrlState => ({
  ...state,
  cursor: nextCursor,
  trail: state.cursor ? [...state.trail, state.cursor] : [...state.trail],
});

export const getPreviousReferenceListState = (
  state: ReferenceListUrlState,
): ReferenceListUrlState | null => {
  if (!state.cursor) {
    return null;
  }

  if (state.trail.length === 0) {
    return {
      ...state,
      cursor: null,
      trail: [],
    };
  }

  const nextTrail = state.trail.slice(0, -1);
  const previousCursor = state.trail.at(-1) ?? null;

  return {
    ...state,
    cursor: previousCursor,
    trail: nextTrail,
  };
};
