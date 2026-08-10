'use client';

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReferenceDetailView } from './reference-detail-view';

const pathnameMock = vi.fn();
const useSearchParamsMock = vi.fn();
const handleSessionErrorMock = vi.fn();
const sessionUserMock = vi.fn();

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

const buildReference = (overrides?: Partial<Record<string, unknown>>) => ({
  id: 'ref-1',
  externalReference: 'EXT-REF-1',
  concept: 'Matrícula agosto',
  amount: 125050,
  currency: 'MXN',
  dueDate: '2026-08-20T15:00:00.000Z',
  status: 'PENDING',
  version: 1,
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-01T12:30:00.000Z',
  createdBy: {
    id: 'u-1',
    username: 'operator',
    role: 'OPERATOR',
  },
  ...overrides,
});

const buildHistory = (overrides?: Partial<Record<string, unknown>>) => ({
  id: 'audit-1',
  actorType: 'USER',
  actorId: 'u-1',
  action: 'CREATE_REFERENCE',
  result: 'SUCCESS',
  correlationId: 'corr-1',
  metadata: {
    expectedVersion: 1,
  },
  createdAt: '2026-08-01T12:00:00.000Z',
  ...overrides,
});

describe('ReferenceDetailView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pathnameMock.mockReturnValue('/references/ref-1');
    useSearchParamsMock.mockReturnValue(
      new URLSearchParams('returnTo=%2Freferences%3Fstatus%3DPENDING'),
    );
    handleSessionErrorMock.mockReset();
    handleSessionErrorMock.mockReturnValue(false);
    sessionUserMock.mockReset();
    sessionUserMock.mockReturnValue({
      userId: 'u-1',
      username: 'operator',
      role: 'OPERATOR',
    });
  });

  it('renders reference summary and audit history without cancel controls for operators', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      jsonResponse(200, {
        reference: buildReference({ version: 3 }),
        history: [
          buildHistory(),
          buildHistory({
            id: 'audit-2',
            action: 'CREATE_REFERENCE',
            result: 'REPLAYED',
            createdAt: '2026-08-01T12:01:00.000Z',
          }),
        ],
      }),
    );

    render(<ReferenceDetailView referenceId="ref-1" />);

    expect(await screen.findByText('Matrícula agosto')).toBeInTheDocument();
    expect(screen.getByText('EXT-REF-1')).toBeInTheDocument();
    expect(screen.getByText('CREATE REFERENCE · SUCCESS')).toBeInTheDocument();
    expect(screen.getByText('CREATE REFERENCE · REPLAYED')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Volver' }),
    ).toHaveAttribute('href', '/references?status=PENDING');
    expect(
      screen.queryByRole('button', { name: 'Cancelar referencia' }),
    ).not.toBeInTheDocument();
  });

  it('shows a recoverable not-found state for stale routes', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      jsonResponse(404, {
        code: 'REFERENCE_NOT_FOUND',
        message: 'Reference not found',
      }),
    );

    render(<ReferenceDetailView referenceId="missing-ref" />);

    expect(await screen.findByText('Referencia no encontrada')).toBeInTheDocument();
    expect(
      screen.getByText(
        'La referencia que abriste ya no existe o cambió antes de que pudieras verla.',
      ),
    ).toBeInTheDocument();
  });

  it('confirms cancel, sends the visible version, and refreshes the detail after success', async () => {
    sessionUserMock.mockReturnValue({
      userId: 'u-2',
      username: 'supervisor',
      role: 'SUPERVISOR',
    });

    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse(200, {
          reference: buildReference({ version: 1 }),
          history: [buildHistory()],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(201, {
          ...buildReference({ status: 'CANCELLED', version: 2 }),
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          reference: buildReference({ status: 'CANCELLED', version: 2 }),
          history: [
            buildHistory(),
            buildHistory({
              id: 'audit-2',
              action: 'CANCEL_REFERENCE',
              result: 'SUCCESS',
              createdAt: '2026-08-01T12:10:00.000Z',
            }),
          ],
        }),
      );

    const user = userEvent.setup();

    render(<ReferenceDetailView referenceId="ref-1" />);

    expect(await screen.findByRole('button', { name: 'Cancelar referencia' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancelar referencia' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar cancelación' }));

    await waitFor(() => {
      expect(screen.getByText('Referencia cancelada correctamente. Refrescamos el detalle con la última versión.')).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/references/ref-1/cancel',
      expect.objectContaining({
        body: JSON.stringify({ version: 1 }),
        cache: 'no-store',
        credentials: 'include',
        method: 'POST',
      }),
    );
    expect(screen.getAllByText('Cancelada').length).toBeGreaterThan(0);
    expect(screen.getByText('CANCEL REFERENCE · SUCCESS')).toBeInTheDocument();
  });

  it('renders the cancel confirmation as an accessible dialog and closes it with Escape', async () => {
    sessionUserMock.mockReturnValue({
      userId: 'u-2',
      username: 'supervisor',
      role: 'SUPERVISOR',
    });

    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      jsonResponse(200, {
        reference: buildReference({ version: 4 }),
        history: [buildHistory()],
      }),
    );

    const user = userEvent.setup();

    render(<ReferenceDetailView referenceId="ref-1" />);

    await user.click(await screen.findByRole('button', { name: 'Cancelar referencia' }));

    const dialog = screen.getByRole('alertdialog', { name: 'Cancelar referencia de pago' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Volver' })).toHaveFocus();
    expect(
      within(dialog).getByText(
        'Esta acción inhabilitará permanentemente la referencia. ¿Estás seguro de continuar?',
      ),
    ).toBeInTheDocument();

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(
        screen.queryByRole('alertdialog', { name: 'Cancelar referencia de pago' }),
      ).not.toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cancelar referencia' })).toHaveFocus();
    });
  });

  it('refetches after a version conflict and retries with the latest version', async () => {
    sessionUserMock.mockReturnValue({
      userId: 'u-2',
      username: 'supervisor',
      role: 'SUPERVISOR',
    });

    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse(200, {
          reference: buildReference({ version: 1 }),
          history: [buildHistory()],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(409, {
          code: 'REFERENCE_VERSION_CONFLICT',
          message: 'Reference version conflict',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          reference: buildReference({ version: 2 }),
          history: [
            buildHistory(),
            buildHistory({
              id: 'audit-2',
              action: 'CANCEL_REFERENCE',
              result: 'REJECTED_VERSION_CONFLICT',
              createdAt: '2026-08-01T12:05:00.000Z',
            }),
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(201, {
          ...buildReference({ status: 'CANCELLED', version: 3 }),
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          reference: buildReference({ status: 'CANCELLED', version: 3 }),
          history: [
            buildHistory(),
            buildHistory({
              id: 'audit-2',
              action: 'CANCEL_REFERENCE',
              result: 'REJECTED_VERSION_CONFLICT',
              createdAt: '2026-08-01T12:05:00.000Z',
            }),
            buildHistory({
              id: 'audit-3',
              action: 'CANCEL_REFERENCE',
              result: 'SUCCESS',
              createdAt: '2026-08-01T12:06:00.000Z',
            }),
          ],
        }),
      );

    const user = userEvent.setup();

    render(<ReferenceDetailView referenceId="ref-1" />);

    expect(await screen.findByRole('button', { name: 'Cancelar referencia' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancelar referencia' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar cancelación' }));

    expect(
      await screen.findByText(
        'La referencia cambió mientras confirmabas la cancelación. Ya refrescamos el detalle con la última versión para que revises el estado actual antes de intentarlo de nuevo.',
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancelar referencia' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar cancelación' }));

    await waitFor(() => {
      expect(screen.getByText('Referencia cancelada correctamente. Refrescamos el detalle con la última versión.')).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/references/ref-1/cancel',
      expect.objectContaining({
        body: JSON.stringify({ version: 1 }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      '/api/references/ref-1/cancel',
      expect.objectContaining({
        body: JSON.stringify({ version: 2 }),
      }),
    );
  });

  it('recovers from INVALID_REFERENCE_STATE by refetching and removing the cancel action', async () => {
    sessionUserMock.mockReturnValue({
      userId: 'u-2',
      username: 'supervisor',
      role: 'SUPERVISOR',
    });

    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse(200, {
          reference: buildReference({ version: 1 }),
          history: [buildHistory()],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(409, {
          code: 'INVALID_REFERENCE_STATE',
          message: 'Reference cannot be cancelled from the current state',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          reference: buildReference({ status: 'PAID', version: 2 }),
          history: [
            buildHistory(),
            buildHistory({
              id: 'audit-2',
              action: 'CANCEL_REFERENCE',
              result: 'REJECTED_INVALID_STATUS',
              createdAt: '2026-08-01T12:05:00.000Z',
            }),
          ],
        }),
      );

    const user = userEvent.setup();

    render(<ReferenceDetailView referenceId="ref-1" />);

    expect(await screen.findByRole('button', { name: 'Cancelar referencia' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancelar referencia' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar cancelación' }));

    expect(
      await screen.findByText(
        'La referencia cambió de estado antes de completar la cancelación. Ya refrescamos el detalle para que confirmes si todavía hace falta alguna acción.',
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Pagada').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Cancelar referencia' })).toBeDisabled();
  });
});
