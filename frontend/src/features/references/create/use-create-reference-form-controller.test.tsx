'use client';

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCreateReferenceFormController } from './use-create-reference-form-controller';

const pushMock = vi.fn();
const handleSessionErrorMock = vi.fn();
const createReferenceMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('@/lib/session/session-provider', () => ({
  useSession: () => ({
    handleSessionError: handleSessionErrorMock,
  }),
}));

vi.mock('./api', () => ({
  createReference: (...args: unknown[]) => createReferenceMock(...args),
}));

describe('useCreateReferenceFormController', () => {
  beforeEach(() => {
    pushMock.mockReset();
    handleSessionErrorMock.mockReset();
    handleSessionErrorMock.mockReturnValue(false);
    createReferenceMock.mockReset();
  });

  it('reuses the same idempotency intent key across retries for the same payload', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('intent-1');
    createReferenceMock
      .mockRejectedValueOnce(new Error('Boom'))
      .mockResolvedValueOnce({ id: 'ref-1' });

    const { result } = renderHook(() => useCreateReferenceFormController());

    act(() => {
      result.current.setConcept(' Matrícula agosto ');
      result.current.setAmount('1250.50');
      result.current.setCurrency('COP');
      result.current.setDueDate('2026-08-20T10:00');
    });

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: vi.fn() } as never);
    });

    expect(result.current.feedback).toEqual({
      message: 'No pudimos crear la referencia. Revisa los datos o inténtalo de nuevo.',
      tone: 'error',
    });

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: vi.fn() } as never);
    });

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/references?created=ref-1');
    });

    expect(createReferenceMock).toHaveBeenCalledTimes(2);
    expect(createReferenceMock.mock.calls[0]?.[1]).toBe('intent-1');
    expect(createReferenceMock.mock.calls[1]?.[1]).toBe('intent-1');
  });
});
