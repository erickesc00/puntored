'use client';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReferenceWorkspace } from './reference-workspace';

const pushMock = vi.fn();
const pathnameMock = vi.fn();
const useSearchParamsMock = vi.fn();
const handleSessionErrorMock = vi.fn();
const routerMock = { push: pushMock };

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => pathnameMock(),
  useSearchParams: () => useSearchParamsMock(),
}));

vi.mock('@/lib/session/session-provider', () => ({
  useSession: () => ({
    handleSessionError: handleSessionErrorMock,
  }),
}));

const jsonResponse = (status: number, body?: unknown) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers:
      status === 204
        ? undefined
        : {
            'content-type': 'application/json',
          },
    statusText: status >= 400 ? 'Request failed' : 'OK',
  });

const firstReference = {
  id: 'ref-1',
  externalReference: 'ext-1',
  concept: 'Matrícula agosto',
  amount: 125050,
  currency: 'COP',
  dueDate: '2026-08-20T15:00:00.000Z',
  status: 'PENDING' as const,
  version: 1,
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-01T12:00:00.000Z',
  createdBy: {
    id: 'u-1',
    username: 'operator',
  },
};

describe('ReferenceWorkspace', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    pathnameMock.mockReturnValue('/references');
    useSearchParamsMock.mockReturnValue(new URLSearchParams());
    handleSessionErrorMock.mockReset();
    handleSessionErrorMock.mockReturnValue(false);
  });

  it('restores filters from the URL and fetches the matching list slice', async () => {
    useSearchParamsMock.mockReturnValue(
      new URLSearchParams(
        'search=Tuition&status=PENDING&createdFrom=2026-08-01&createdTo=2026-08-10&limit=20&cursor=cursor-2&trail=cursor-1',
      ),
    );

    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      jsonResponse(200, {
        items: [firstReference],
        pageInfo: { nextCursor: 'cursor-3' },
      }),
    );

    render(<ReferenceWorkspace />);

    expect(await screen.findByDisplayValue('Tuition')).toBeInTheDocument();
    expect(screen.getByLabelText('Estado')).toHaveValue('PENDING');
    expect(screen.getByDisplayValue('2026-08-01')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2026-08-10')).toBeInTheDocument();
    expect(screen.getByLabelText('Resultados por página')).toHaveValue('20');
    expect((await screen.findAllByText('Matrícula agosto')).length).toBeGreaterThan(0);
    expect(screen.getByText('Página 3 · 1 resultado')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/references?search=Tuition&status=PENDING&createdFrom=2026-08-01T00%3A00%3A00.000Z&createdTo=2026-08-10T23%3A59%3A59.999Z&limit=20&cursor=cursor-2',
      expect.objectContaining({
        cache: 'no-store',
        credentials: 'include',
        method: 'GET',
      }),
    );
  });

  it('shows an explicit empty state when the list response has no matches', async () => {
    useSearchParamsMock.mockReturnValue(
      new URLSearchParams('search=Nope&status=PAID'),
    );

    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      jsonResponse(200, {
        items: [],
        pageInfo: { nextCursor: null },
      }),
    );

    render(<ReferenceWorkspace />);

    expect(await screen.findByText('No hay referencias para mostrar')).toBeInTheDocument();
    expect(
      screen.getByText('Probá ajustar la búsqueda o limpiar los filtros.'),
    ).toBeInTheDocument();
  });

  it('shows a recoverable error state and retries reliably without changing the URL', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse(500, {
          code: 'UNKNOWN_ERROR',
          message: 'Boom',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          items: [firstReference],
          pageInfo: { nextCursor: null },
        }),
      );

    const user = userEvent.setup();

    render(<ReferenceWorkspace />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No pudimos cargar las referencias. Probá nuevamente.',
    );

    await user.click(screen.getByRole('button', { name: 'Reintentar' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect((await screen.findAllByText('Matrícula agosto')).length).toBeGreaterThan(0);
  });
});
