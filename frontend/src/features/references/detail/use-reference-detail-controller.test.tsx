'use client';

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@/lib/api/errors';
import { useReferenceDetailController } from './use-reference-detail-controller';

const pathnameMock = vi.fn();
const useSearchParamsMock = vi.fn();
const handleSessionErrorMock = vi.fn();
const sessionUserMock = vi.fn();
const fetchReferenceDetailMock = vi.fn();
const cancelReferenceMock = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => pathnameMock(),
  useSearchParams: () => useSearchParamsMock(),
}));

vi.mock('@/lib/session/session-provider', () => ({
  useSession: () => ({
    handleSessionError: handleSessionErrorMock,
    user: sessionUserMock(),
  }),
}));

vi.mock('./api', () => ({
  fetchReferenceDetail: (...args: unknown[]) => fetchReferenceDetailMock(...args),
}));

vi.mock('@/features/references/cancel/api', () => ({
  cancelReference: (...args: unknown[]) => cancelReferenceMock(...args),
}));

const buildDetailResponse = (version: number, status: 'PENDING' | 'CANCELLED' = 'PENDING') => ({
  reference: {
    id: 'ref-1',
    externalReference: 'EXT-REF-1',
    concept: 'Matrícula agosto',
    amount: 125050,
    currency: 'MXN',
    dueDate: '2026-08-20T15:00:00.000Z',
    status,
    version,
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:30:00.000Z',
    createdBy: {
      id: 'u-1',
      username: 'operator',
      role: 'SUPERVISOR',
    },
  },
  history: [],
});

describe('useReferenceDetailController', () => {
  beforeEach(() => {
    pathnameMock.mockReturnValue('/references/ref-1');
    useSearchParamsMock.mockReturnValue(
      new URLSearchParams('returnTo=%2Freferences%3Fstatus%3DPENDING'),
    );
    handleSessionErrorMock.mockReset();
    handleSessionErrorMock.mockReturnValue(false);
    sessionUserMock.mockReset();
    sessionUserMock.mockReturnValue({ role: 'SUPERVISOR' });
    fetchReferenceDetailMock.mockReset();
    cancelReferenceMock.mockReset();
  });

  it('refetches the latest detail when cancellation hits a version conflict', async () => {
    fetchReferenceDetailMock
      .mockResolvedValueOnce(buildDetailResponse(1))
      .mockResolvedValueOnce(buildDetailResponse(2));
    cancelReferenceMock.mockRejectedValue(
      new ApiClientError({
        statusCode: 409,
        code: 'REFERENCE_VERSION_CONFLICT',
        message: 'Version conflict',
      }),
    );

    const { result } = renderHook(() => useReferenceDetailController('ref-1'));

    await waitFor(() => {
      expect(result.current.detail?.reference.version).toBe(1);
    });

    act(() => {
      result.current.openCancelConfirmation();
    });

    await act(async () => {
      await result.current.confirmCancel();
    });

    await waitFor(() => {
      expect(result.current.feedback?.message).toBe(
        'La referencia cambió mientras confirmabas la cancelación. Ya refrescamos el detalle con la última versión para que revises el estado actual antes de intentarlo de nuevo.',
      );
    });

    expect(cancelReferenceMock).toHaveBeenCalledWith('ref-1', 1);
    expect(result.current.detail?.reference.version).toBe(2);
    expect(result.current.isConfirmingCancel).toBe(false);
  });
});
