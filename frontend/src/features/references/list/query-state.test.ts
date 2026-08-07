import { describe, expect, it } from 'vitest';
import {
  buildReferenceListApiSearchParams,
  buildReferenceListSearchParams,
  getNextReferenceListState,
  getPreviousReferenceListState,
  parseReferenceListUrlState,
} from './query-state';

describe('reference list query state', () => {
  it('parses URL params into a normalized route-driven state', () => {
    const state = parseReferenceListUrlState(
      new URLSearchParams(
        'search=Tuition&status=PENDING&createdFrom=2026-08-01&createdTo=2026-08-10&limit=20&cursor=abc&trail=prev-1,prev-2',
      ),
    );

    expect(state).toEqual({
      search: 'Tuition',
      status: 'PENDING',
      createdFrom: '2026-08-01',
      createdTo: '2026-08-10',
      limit: 20,
      cursor: 'abc',
      trail: ['prev-1', 'prev-2'],
    });
  });

  it('builds API params and cursor trail transitions consistently', () => {
    const firstPage = parseReferenceListUrlState(
      new URLSearchParams('search=Rent&createdFrom=2026-08-05&limit=10'),
    );
    const secondPage = getNextReferenceListState(firstPage, 'cursor-1');
    const thirdPage = getNextReferenceListState(secondPage, 'cursor-2');

    expect(buildReferenceListSearchParams(thirdPage).toString()).toBe(
      'search=Rent&createdFrom=2026-08-05&cursor=cursor-2&trail=cursor-1',
    );
    expect(buildReferenceListApiSearchParams(thirdPage).toString()).toBe(
      'search=Rent&createdFrom=2026-08-05T00%3A00%3A00.000Z&limit=10&cursor=cursor-2',
    );
    expect(getPreviousReferenceListState(thirdPage)).toEqual({
      ...secondPage,
      cursor: 'cursor-1',
      trail: [],
    });
  });
});
