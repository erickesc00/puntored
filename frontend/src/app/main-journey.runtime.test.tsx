'use client';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginPageClient } from './login/login-page-client';
import { CreateReferenceForm } from '@/features/references/create/create-reference-form';
import { ReferenceDetailView } from '@/features/references/detail/reference-detail-view';
import { ReferenceWorkspace } from '@/features/references/list/reference-workspace';
import type {
  ReferenceAuditEntry,
  ReferenceSummary,
} from '@/features/references/shared/types';

type SessionMockValue = {
  user: { userId: string; username: string; role: string } | null;
  status: 'idle' | 'loading' | 'authenticated' | 'anonymous';
  login: (options: {
    username: string;
    password: string;
    returnTo?: string;
  }) => Promise<void>;
  refreshSession: (options?: {
    redirectOnAuthLoss?: boolean;
    returnTo?: string;
  }) => Promise<unknown>;
  handleSessionError: (error: unknown, returnTo?: string) => boolean;
};

const replaceMock = vi.fn();
const pushMock = vi.fn();

let pathname = '/login';
let searchParams = new URLSearchParams();
let sessionMockValue: SessionMockValue = {
  user: null,
  status: 'anonymous',
  login: async () => undefined,
  refreshSession: async () => null,
  handleSessionError: () => false,
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: replaceMock,
    push: pushMock,
  }),
  usePathname: () => pathname,
  useSearchParams: () => searchParams,
}));

vi.mock('@/lib/session/session-provider', async () => {
  const actual = await vi.importActual<typeof import('@/lib/session/session-provider')>(
    '@/lib/session/session-provider',
  );

  return {
    ...actual,
    useSession: () => sessionMockValue,
  };
});

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

function createJourneyBackend(options?: { expireReferenceList?: boolean }) {
  const references = new Map<string, ReferenceSummary>();
  const histories = new Map<string, ReferenceAuditEntry[]>();
  const idempotencyResponses = new Map<string, { fingerprint: string; response: ReferenceSummary }>();

  const readJsonBody = (init?: RequestInit) => {
    if (!init?.body || typeof init.body !== 'string') {
      return null;
    }

    return JSON.parse(init.body) as Record<string, unknown>;
  };

  return async (input: string | URL | Request, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(rawUrl, 'http://localhost');
    const path = url.pathname;

    if (path === '/api/references' && init?.method === 'POST') {
      const payload = readJsonBody(init);
      const headers = new Headers(init?.headers);
      const idempotencyKey = headers.get('Idempotency-Key') ?? '';
      const fingerprint = JSON.stringify(payload);
      const existing = idempotencyResponses.get(idempotencyKey);

      if (existing?.fingerprint === fingerprint) {
        return jsonResponse(201, existing.response);
      }

      const response: ReferenceSummary = {
        id: `ref-${references.size + 1}`,
        externalReference: `EXT-JOURNEY-${String(references.size + 1).padStart(3, '0')}`,
        concept: String(payload?.concept ?? ''),
        amount: Number(payload?.amount ?? 0),
        currency: String(payload?.currency ?? 'COP'),
        dueDate: String(payload?.dueDate ?? ''),
        status: 'PENDING',
        version: 1,
        createdAt: '2026-08-07T00:00:00.000Z',
        updatedAt: '2026-08-07T00:00:00.000Z',
        createdBy: {
          id: 'u-supervisor',
          username: 'supervisor',
          role: 'SUPERVISOR',
        },
      };

      references.set(response.id, response);
      histories.set(response.id, [
        {
          id: `audit-${response.id}-1`,
          actorType: 'USER',
          actorId: 'u-supervisor',
          action: 'CREATE_REFERENCE',
          result: 'SUCCESS',
          correlationId: `corr-${response.id}-create`,
          metadata: { version: 1 },
          createdAt: '2026-08-07T00:00:00.000Z',
        },
      ]);
      idempotencyResponses.set(idempotencyKey, { fingerprint, response });

      return jsonResponse(201, response);
    }

    if (path === '/api/references' && init?.method === 'GET') {
      if (options?.expireReferenceList) {
        return jsonResponse(401, {
          code: 'SESSION_EXPIRED',
          message: 'Session expired',
        });
      }

      return jsonResponse(200, {
        items: [...references.values()],
        pageInfo: { nextCursor: null },
      });
    }

    const detailMatch = path.match(/^\/api\/references\/([^/]+)$/);
    if (detailMatch && init?.method === 'GET') {
      const referenceId = decodeURIComponent(detailMatch[1] ?? '');
      const reference = references.get(referenceId);

      if (!reference) {
        return jsonResponse(404, {
          code: 'REFERENCE_NOT_FOUND',
          message: 'Reference not found',
        });
      }

      return jsonResponse(200, {
        reference,
        history: histories.get(referenceId) ?? [],
      });
    }

    const cancelMatch = path.match(/^\/api\/references\/([^/]+)\/cancel$/);
    if (cancelMatch && init?.method === 'POST') {
      const referenceId = decodeURIComponent(cancelMatch[1] ?? '');
      const reference = references.get(referenceId);

      if (!reference) {
        return jsonResponse(404, {
          code: 'REFERENCE_NOT_FOUND',
          message: 'Reference not found',
        });
      }

      const payload = readJsonBody(init);
      const version = Number(payload?.version ?? 0);

      if (reference.version !== version) {
        return jsonResponse(409, {
          code: 'REFERENCE_VERSION_CONFLICT',
          message: 'Reference version conflict',
        });
      }

      const cancelledReference: ReferenceSummary = {
        ...reference,
        status: 'CANCELLED',
        version: reference.version + 1,
        updatedAt: '2026-08-07T00:15:00.000Z',
      };

      references.set(referenceId, cancelledReference);
      histories.set(referenceId, [
        ...(histories.get(referenceId) ?? []),
        {
          id: `audit-${referenceId}-2`,
          actorType: 'USER',
          actorId: 'u-supervisor',
          action: 'CANCEL_REFERENCE',
          result: 'SUCCESS',
          correlationId: `corr-${referenceId}-cancel`,
          metadata: { version },
          createdAt: '2026-08-07T00:15:00.000Z',
        },
      ]);

      return jsonResponse(201, cancelledReference);
    }

    if (path === '/api/auth/me' && init?.method === 'GET') {
      return jsonResponse(401, {
        code: 'SESSION_EXPIRED',
        message: 'Session expired',
      });
    }

    return jsonResponse(404, {
      code: 'UNKNOWN_ROUTE',
      message: `Unhandled path: ${path}`,
    });
  };
}

describe('frontend runtime journey', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    replaceMock.mockReset();
    pushMock.mockReset();
    pathname = '/login';
    searchParams = new URLSearchParams();
    sessionMockValue = {
      user: null,
      status: 'anonymous',
      login: async () => undefined,
      refreshSession: async () => null,
      handleSessionError: () => false,
    };
  });

  it('covers login, create, list, detail, and supervisor cancel with rendered screens', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(createJourneyBackend());
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('intent-journey');

    const user = userEvent.setup();
    const loginMock = vi.fn(async ({ returnTo }: { returnTo?: string }) => {
      replaceMock(returnTo ?? '/references');
    });

    sessionMockValue = {
      ...sessionMockValue,
      login: loginMock,
      refreshSession: async () => null,
    };

    render(<LoginPageClient />);

    fireEvent.change(screen.getByLabelText('Usuario'), {
      target: { value: 'supervisor' },
    });
    fireEvent.change(screen.getByLabelText('Contraseña'), {
      target: { value: 'Puntored123!' },
    });
    await user.click(screen.getByRole('button', { name: 'Ingresar' }));

    expect(loginMock).toHaveBeenCalledWith({
      username: 'supervisor',
      password: 'Puntored123!',
      returnTo: '/references',
    });
    expect(replaceMock).toHaveBeenCalledWith('/references');

    pathname = '/references/new';
    searchParams = new URLSearchParams();
    sessionMockValue = {
      user: {
        userId: 'u-supervisor',
        username: 'supervisor',
        role: 'SUPERVISOR',
      },
      status: 'authenticated',
      login: async () => undefined,
      refreshSession: async () => null,
      handleSessionError: () => false,
    };

    const { unmount } = render(<CreateReferenceForm />);

    fireEvent.change(screen.getByLabelText(/Concepto de Recaudo/i), {
      target: { value: 'Matrícula agosto' },
    });
    fireEvent.change(screen.getByLabelText('Monto'), {
      target: { value: '1250.50' },
    });
    fireEvent.change(screen.getByLabelText(/Moneda/i), {
      target: { value: 'COP' },
    });
    fireEvent.change(screen.getByLabelText(/Fecha de Vencimiento/i), {
      target: { value: '2026-08-20T10:00' },
    });

    await user.click(screen.getByRole('button', { name: 'Crear referencia' }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/references?created=ref-1');
    });
    unmount();

    pathname = '/references';
    searchParams = new URLSearchParams('created=ref-1');

    const listRender = render(<ReferenceWorkspace />);

    expect(
      await screen.findByText(/Referencia creada correctamente\. ID:/),
    ).toBeInTheDocument();
    expect((await screen.findAllByText('Matrícula agosto')).length).toBeGreaterThan(0);

    const detailLink = screen.getAllByRole('link', {
      name: 'Ver detalle de Matrícula agosto',
    })[0];

    expect(detailLink).toHaveAttribute(
      'href',
      '/references/ref-1?returnTo=%2Freferences%3Fcreated%3Dref-1',
    );
    listRender.unmount();

    pathname = '/references/ref-1';
    searchParams = new URLSearchParams('returnTo=%2Freferences%3Fcreated%3Dref-1');

    render(<ReferenceDetailView referenceId="ref-1" />);

    expect(await screen.findByRole('heading', { name: 'Matrícula agosto' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar referencia' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancelar referencia' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar cancelación' }));

    expect(
      await screen.findByText(
        'Referencia cancelada correctamente. Refrescamos el detalle con la última versión.',
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Cancelada').length).toBeGreaterThan(0);
    expect(screen.getByText('CANCEL REFERENCE · SUCCESS')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver' })).toHaveAttribute(
      'href',
      '/references?created=ref-1',
    );

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/references/ref-1/cancel',
      expect.objectContaining({
        body: JSON.stringify({ version: 1 }),
        cache: 'no-store',
        credentials: 'include',
        method: 'POST',
      }),
    );
  });

  it('handles auth loss on a protected route by redirecting back to login with context', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(
      createJourneyBackend({ expireReferenceList: true }),
    );
    sessionMockValue = {
      ...sessionMockValue,
      handleSessionError: (error, returnTo) => {
        const apiError = error as { code?: string };

        if (apiError.code !== 'SESSION_EXPIRED') {
          return false;
        }

        replaceMock(`/login?reason=expired&returnTo=${encodeURIComponent(returnTo ?? '/references')}`);
        return true;
      },
    };

    pathname = '/references';
    searchParams = new URLSearchParams('status=PENDING');

    render(<ReferenceWorkspace />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith(
        '/login?reason=expired&returnTo=%2Freferences%3Fstatus%3DPENDING',
      );
    });
  });
});
