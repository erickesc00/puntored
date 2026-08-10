'use client';

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@/lib/api/errors';
import { useReferenceWorkspaceController } from './use-reference-workspace-controller';

const pushMock = vi.fn();
const pathnameMock = vi.fn();
const useSearchParamsMock = vi.fn();
const handleSessionErrorMock = vi.fn();
const fetchReferenceListMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => pathnameMock(),
  useSearchParams: () => useSearchParamsMock(),
}));

vi.mock('@/lib/session/session-provider', () => ({
  useSession: () => ({
    handleSessionError: handleSessionErrorMock,
  }),
}));

vi.mock('./api', () => ({
  fetchReferenceList: (...args: unknown[]) => fetchReferenceListMock(...args),
}));

describe('useReferenceWorkspaceController', () => {
  beforeEach(() => {
    pushMock.mockReset();
    pathnameMock.mockReturnValue('/references');
    useSearchParamsMock.mockReturnValue(new URLSearchParams());
    handleSessionErrorMock.mockReset();
    handleSessionErrorMock.mockReturnValue(false);
    fetchReferenceListMock.mockReset();
    fetchReferenceListMock.mockResolvedValue({
      items: [],
      pageInfo: { nextCursor: null },
    });
  });

  it('trims and pushes the next filter state through the router boundary', async () => {
    const { result } = renderHook(() => useReferenceWorkspaceController());

    await waitFor(() => {
      expect(fetchReferenceListMock).toHaveBeenCalledTimes(1);
    });

    act(() => {
      result.current.setSearch('  Tuition  ');
      result.current.setStatus('PENDING');
      result.current.setLimit(20);
    });

    act(() => {
      result.current.submitFilters();
    });

    expect(pushMock).toHaveBeenCalledWith('/references?search=Tuition&status=PENDING&limit=20');
  });

  it('navigates to the next page using the fetched cursor', async () => {
    fetchReferenceListMock.mockResolvedValue({
      items: [],
      pageInfo: { nextCursor: 'cursor-2' },
    });

    const { result } = renderHook(() => useReferenceWorkspaceController());

    await waitFor(() => {
      expect(result.current.nextCursor).toBe('cursor-2');
    });

    act(() => {
      result.current.goToNextPage();
    });

    expect(pushMock).toHaveBeenCalledWith('/references?cursor=cursor-2');
  });

  it('guides recovery from invalid cursors by resetting pagination while preserving filters', async () => {
    useSearchParamsMock.mockReturnValue(
      new URLSearchParams('search=Tuition&status=PENDING&cursor=cursor-2&trail=cursor-1'),
    );
    fetchReferenceListMock.mockRejectedValue(
      new ApiClientError({
        statusCode: 409,
        code: 'INVALID_CURSOR',
        message: 'Cursor expired',
      }),
    );

    const { result } = renderHook(() => useReferenceWorkspaceController());

    await waitFor(() => {
      expect(result.current.errorCode).toBe('INVALID_CURSOR');
    });

    act(() => {
      result.current.resetPagination();
    });

    expect(pushMock).toHaveBeenCalledWith('/references?search=Tuition&status=PENDING');
  });
});
