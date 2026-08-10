'use client';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateReferenceForm } from './create-reference-form';

const pushMock = vi.fn();
const handleSessionErrorMock = vi.fn();
const routerMock = { push: pushMock };

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
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

const fillValidForm = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByLabelText(/Concepto de Recaudo/i), ' Matrícula agosto ');
  await user.type(screen.getByLabelText('Monto'), '1250.50');
  await user.type(screen.getByLabelText(/Fecha de Vencimiento/i), '2026-08-20T10:00');
};

describe('CreateReferenceForm', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    handleSessionErrorMock.mockReset();
    handleSessionErrorMock.mockReturnValue(false);
  });

  it('submits successfully with the intended UTC instant and redirects back to the list', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('intent-1');

    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      jsonResponse(201, {
        id: 'ref-1',
        externalReference: 'EXT-REF-1',
      }),
    );

    const user = userEvent.setup();

    render(<CreateReferenceForm />);
    await fillValidForm(user);

    await user.click(screen.getByRole('button', { name: 'Crear referencia' }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/references?created=ref-1');
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, request] = fetchMock.mock.calls[0];
    const headers = request?.headers as Headers;

    expect(path).toBe('/api/references');
    expect(headers.get('Idempotency-Key')).toBe('intent-1');
    expect(JSON.parse(String(request?.body))).toEqual({
      concept: 'Matrícula agosto',
      amount: 125050,
      currency: 'MXN',
      dueDate: new Date(2026, 7, 20, 10, 0, 0, 0).toISOString(),
    });
  });

  it('defaults the currency selector to MXN and keeps MXN first in the options list', () => {
    render(<CreateReferenceForm />);

    const currencySelect = screen.getByLabelText(/Moneda/i);
    const optionLabels = screen
      .getAllByRole('option')
      .map((option) => option.textContent);

    expect(currencySelect).toHaveValue('MXN');
    expect(optionLabels).toEqual(['MXN', 'COP', 'USD', 'EUR']);
  });

  it('blocks invalid form submissions before calling the API', async () => {
    const fetchMock = vi.spyOn(global, 'fetch');
    const user = userEvent.setup();

    render(<CreateReferenceForm />);

    await user.click(screen.getByRole('button', { name: 'Crear referencia' }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await screen.findByText('Ingresa un concepto.')).toBeInTheDocument();
    expect(
      screen.getByText('Ingresa un monto válido con hasta dos decimales.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Ingresa una fecha y hora de vencimiento válida.'),
    ).toBeInTheDocument();
  });

  it('reuses the same Idempotency-Key when the user retries the same intent', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('intent-1');

    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse(500, {
          code: 'UNKNOWN_ERROR',
          message: 'Boom',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(201, {
          id: 'ref-1',
          externalReference: 'EXT-REF-1',
        }),
      );

    const user = userEvent.setup();

    render(<CreateReferenceForm />);
    await fillValidForm(user);

    await user.click(screen.getByRole('button', { name: 'Crear referencia' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No pudimos crear la referencia. Revisa los datos o inténtalo de nuevo.',
    );

    await user.click(screen.getByRole('button', { name: 'Crear referencia' }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/references?created=ref-1');
    });

    const firstHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    const secondHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Headers;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(firstHeaders.get('Idempotency-Key')).toBe('intent-1');
    expect(secondHeaders.get('Idempotency-Key')).toBe('intent-1');
  });

  it('guides recovery from idempotency conflicts by rotating the next request key', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('intent-1')
      .mockReturnValueOnce('intent-2');

    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse(409, {
          code: 'IDEMPOTENCY_CONFLICT',
          message: 'Conflict',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(201, {
          id: 'ref-2',
          externalReference: 'EXT-REF-2',
        }),
      );

    const user = userEvent.setup();

    render(<CreateReferenceForm />);
    await fillValidForm(user);

    await user.click(screen.getByRole('button', { name: 'Crear referencia' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Detectamos un conflicto con la protección contra duplicados. Ya preparamos un intento nuevo para que revises los datos y vuelvas a enviarlos.',
    );

    await user.click(screen.getByRole('button', { name: 'Crear referencia' }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/references?created=ref-2');
    });

    const firstHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    const secondHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Headers;

    expect(firstHeaders.get('Idempotency-Key')).toBe('intent-1');
    expect(secondHeaders.get('Idempotency-Key')).toBe('intent-2');
  });

  it('does not render the removed retry reset button', () => {
    render(<CreateReferenceForm />);

    expect(
      screen.queryByRole('button', { name: 'Reiniciar intento' }),
    ).not.toBeInTheDocument();
  });
});
