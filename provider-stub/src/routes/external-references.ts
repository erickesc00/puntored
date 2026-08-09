import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  providerReferenceStatuses,
  type ProviderReferenceRepository,
  type ProviderReferenceStatus,
} from '../db/sqlite';

export interface ProviderStubRouteConfig {
  apiKey: string;
  backendCallbackUrl: string;
  providerSharedSecret: string;
  repository: ProviderReferenceRepository;
  fetchImpl?: typeof fetch;
}

export async function registerExternalReferenceRoutes(
  app: FastifyInstance,
  config: ProviderStubRouteConfig,
) {
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;

  app.get('/operator', async (_request, reply) => {
    return reply.type('text/html; charset=utf-8').send(renderOperatorPage());
  });

  app.get('/operator/references', async () => ({
    items: config.repository.list(),
  }));

  app.post(
    '/operator/references/:backendReferenceId/callback',
    {
      schema: {
        params: {
          type: 'object',
          required: ['backendReferenceId'],
          properties: {
            backendReferenceId: { type: 'string', minLength: 1, maxLength: 191 },
          },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['status'],
          properties: {
            status: {
              type: 'string',
              enum: ['PAID', 'CANCELLED'],
            },
          },
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { backendReferenceId: string };
      const body = request.body as { status: ProviderReferenceStatus };

      return triggerProviderCallback({
        backendReferenceId: params.backendReferenceId,
        status: body.status,
        repository: config.repository,
        backendCallbackUrl: config.backendCallbackUrl,
        providerSharedSecret: config.providerSharedSecret,
        fetchImpl,
        reply,
      });
    },
  );

  const requireApiKey = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const apiKey = request.headers['x-stub-api-key'];

    if (typeof apiKey !== 'string' || apiKey.trim() !== config.apiKey) {
      return reply.code(401).send({
        code: 'STUB_UNAUTHORIZED',
        message: 'Stub API authentication failed',
      });
    }
  };

  app.post(
    '/external-references',
    {
      preHandler: requireApiKey,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: [
            'backendReferenceId',
            'concept',
            'amount',
            'currency',
            'dueDate',
          ],
          properties: {
            backendReferenceId: { type: 'string', minLength: 1, maxLength: 191 },
            concept: { type: 'string', minLength: 1, maxLength: 255 },
            amount: { type: 'integer', minimum: 1 },
            currency: { type: 'string', minLength: 3, maxLength: 3 },
            dueDate: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    async (request) => {
      const body = request.body as {
        backendReferenceId: string;
        concept: string;
        amount: number;
        currency: string;
        dueDate: string;
      };

      return config.repository.createOrGet({
        backendReferenceId: body.backendReferenceId.trim(),
        concept: body.concept.trim(),
        amount: body.amount,
        currency: body.currency.trim().toUpperCase(),
        dueDate: new Date(body.dueDate).toISOString(),
      });
    },
  );

  app.get(
    '/external-references',
    {
      preHandler: requireApiKey,
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: {
              type: 'string',
              enum: [...providerReferenceStatuses],
            },
            backendReferenceId: { type: 'string', minLength: 1, maxLength: 191 },
          },
        },
      },
    },
    async (request) => {
      const query = request.query as {
        status?: ProviderReferenceStatus;
        backendReferenceId?: string;
      };

      return {
        items: config.repository.list({
          status: query.status,
          backendReferenceId: query.backendReferenceId?.trim(),
        }),
      };
    },
  );

  app.post(
    '/external-references/:backendReferenceId/callback',
    {
      preHandler: requireApiKey,
      schema: {
        params: {
          type: 'object',
          required: ['backendReferenceId'],
          properties: {
            backendReferenceId: { type: 'string', minLength: 1, maxLength: 191 },
          },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['status'],
          properties: {
            status: {
              type: 'string',
              enum: ['PAID', 'CANCELLED'],
            },
          },
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { backendReferenceId: string };
      const body = request.body as { status: ProviderReferenceStatus };
      return triggerProviderCallback({
        backendReferenceId: params.backendReferenceId,
        status: body.status,
        repository: config.repository,
        backendCallbackUrl: config.backendCallbackUrl,
        providerSharedSecret: config.providerSharedSecret,
        fetchImpl,
        reply,
      });
    },
  );
}

interface TriggerProviderCallbackInput {
  backendReferenceId: string;
  status: ProviderReferenceStatus;
  repository: ProviderReferenceRepository;
  backendCallbackUrl: string;
  providerSharedSecret: string;
  fetchImpl: typeof fetch;
  reply: FastifyReply;
}

async function triggerProviderCallback({
  backendReferenceId,
  status,
  repository,
  backendCallbackUrl,
  providerSharedSecret,
  fetchImpl,
  reply,
}: TriggerProviderCallbackInput) {
  const stored = repository.findByBackendReferenceId(backendReferenceId);

  if (!stored) {
    return reply.code(404).send({
      code: 'STUB_REFERENCE_NOT_FOUND',
      message: 'Provider reference not found',
    });
  }

  const occurredAt = new Date().toISOString();
  const callbackPayload = {
    providerEventId: randomUUID(),
    referenceId: stored.backendReferenceId,
    externalReference: stored.externalReference,
    status,
    occurredAt,
    ...(status === 'PAID' ? { paidAt: occurredAt } : {}),
  };

  const callbackResponse = await fetchImpl(backendCallbackUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-provider-secret': providerSharedSecret,
    },
    body: JSON.stringify(callbackPayload),
  });

  const callbackBody = await safeReadBody(callbackResponse);
  const updatedReference = callbackResponse.ok
    ? repository.updateStatus(stored.backendReferenceId, status)
    : stored;

  return reply.code(200).send({
    providerEventId: callbackPayload.providerEventId,
    reference: updatedReference,
    callback: {
      statusCode: callbackResponse.status,
      body: callbackBody,
    },
  });
}

async function safeReadBody(response: Response) {
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    return response.json();
  }

  const text = await response.text();
  return text.length > 0 ? text : null;
}

function renderOperatorPage() {
  return String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Provider Stub Operator</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Inter, system-ui, sans-serif;
      }
      body {
        margin: 0;
        background: #f5f7fb;
        color: #172033;
      }
      main {
        max-width: 1100px;
        margin: 0 auto;
        padding: 32px 20px 48px;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 28px;
      }
      p {
        margin: 0;
        color: #536076;
      }
      .toolbar,
      .panel {
        background: #fff;
        border: 1px solid #d9e1ee;
        border-radius: 14px;
        box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
      }
      .toolbar {
        margin-top: 20px;
        padding: 16px;
        display: flex;
        gap: 12px;
        align-items: center;
        justify-content: space-between;
      }
      button {
        border: 0;
        border-radius: 10px;
        padding: 10px 14px;
        font: inherit;
        font-weight: 600;
        cursor: pointer;
      }
      button.primary { background: #1d4ed8; color: #fff; }
      button.success { background: #15803d; color: #fff; }
      button.danger { background: #b91c1c; color: #fff; }
      button.secondary { background: #e2e8f0; color: #172033; }
      button:disabled { opacity: 0.6; cursor: wait; }
      .layout {
        display: grid;
        grid-template-columns: minmax(0, 2fr) minmax(320px, 1fr);
        gap: 20px;
        margin-top: 20px;
      }
      .panel { overflow: hidden; }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th, td {
        padding: 14px 16px;
        border-bottom: 1px solid #e5eaf3;
        text-align: left;
        vertical-align: top;
        font-size: 14px;
      }
      th {
        background: #f8fafc;
        color: #445067;
      }
      tr:last-child td { border-bottom: 0; }
      .actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .badge {
        display: inline-flex;
        border-radius: 999px;
        padding: 4px 10px;
        font-size: 12px;
        font-weight: 700;
        background: #e2e8f0;
      }
      .empty,
      .status-text {
        padding: 18px 16px;
        color: #536076;
      }
      .sidebar {
        padding: 16px;
      }
      .sidebar h2 {
        margin: 0 0 12px;
        font-size: 18px;
      }
      pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 13px;
        line-height: 1.45;
        background: #0f172a;
        color: #e2e8f0;
        border-radius: 12px;
        padding: 14px;
        min-height: 260px;
      }
      code { font-family: ui-monospace, SFMono-Regular, monospace; }
      @media (max-width: 900px) {
        .layout { grid-template-columns: 1fr; }
        .toolbar { flex-direction: column; align-items: stretch; }
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Provider Stub Operator</h1>
      <p>Review allocated provider references and trigger provider callbacks without leaving the stub.</p>

      <section class="toolbar">
        <div>
          <strong>References</strong>
          <div class="status-text" id="summary">Loading...</div>
        </div>
        <button class="primary" id="refresh-button" type="button">Refresh list</button>
      </section>

      <section class="layout">
        <div class="panel">
          <table>
            <thead>
              <tr>
                <th>Backend reference</th>
                <th>External reference</th>
                <th>Status</th>
                <th>Details</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="references-table-body">
              <tr><td colspan="5" class="empty">Loading provider references...</td></tr>
            </tbody>
          </table>
        </div>

        <aside class="panel sidebar">
          <h2>Last callback result</h2>
          <pre id="callback-result">Trigger a callback to inspect the backend response.</pre>
        </aside>
      </section>
    </main>

    <script>
      const tableBody = document.getElementById('references-table-body');
      const callbackResult = document.getElementById('callback-result');
      const summary = document.getElementById('summary');
      const refreshButton = document.getElementById('refresh-button');
      let busy = false;

      refreshButton.addEventListener('click', () => loadReferences());

      async function loadReferences() {
        setBusy(true);
        summary.textContent = 'Loading references...';

        try {
          const response = await fetch('/operator/references');
          const payload = await response.json();
          renderRows(payload.items ?? []);
          summary.textContent = String(payload.items?.length ?? 0) + ' reference(s) loaded';
        } catch (error) {
          renderErrorRow('Failed to load references');
          summary.textContent = 'Load failed';
          callbackResult.textContent = formatResult({
            action: 'LOAD_REFERENCES',
            error: error instanceof Error ? error.message : String(error),
          });
        } finally {
          setBusy(false);
        }
      }

      function renderRows(items) {
        if (!items.length) {
          tableBody.innerHTML = '<tr><td colspan="5" class="empty">No provider references stored yet.</td></tr>';
          return;
        }

        tableBody.innerHTML = items.map((item) => {
          const backendReferenceId = escapeHtml(item.backendReferenceId);
          const externalReference = escapeHtml(item.externalReference);
          const status = escapeHtml(item.status);
          const detail = escapeHtml(String(item.currency) + ' ' + String(item.amount) + ' · ' + String(item.concept));

          return [
            '<tr>',
            '<td><code>' + backendReferenceId + '</code></td>',
            '<td><code>' + externalReference + '</code></td>',
            '<td><span class="badge">' + status + '</span></td>',
            '<td>' + detail + '</td>',
            '<td>',
            '<div class="actions">',
            '<button class="success" type="button" data-action="callback" data-reference-id="' + backendReferenceId + '" data-status="PAID">Send PAID</button>',
            '<button class="danger" type="button" data-action="callback" data-reference-id="' + backendReferenceId + '" data-status="CANCELLED">Send CANCELLED</button>',
            '</div>',
            '</td>',
            '</tr>',
          ].join('');
        }).join('');

        for (const button of tableBody.querySelectorAll('button[data-action="callback"]')) {
          button.addEventListener('click', async (event) => {
            const target = event.currentTarget;
            if (!(target instanceof HTMLButtonElement)) {
              return;
            }

            await triggerCallback(target.dataset.referenceId, target.dataset.status, target);
          });
        }
      }

      function renderErrorRow(message) {
        tableBody.innerHTML = '<tr><td colspan="5" class="empty">' + escapeHtml(message) + '</td></tr>';
      }

      async function triggerCallback(referenceId, status, button) {
        if (!referenceId || !status) {
          return;
        }

        setBusy(true, button);
        callbackResult.textContent = 'Sending ' + status + ' callback for ' + referenceId + '...';

        try {
          const response = await fetch('/operator/references/' + encodeURIComponent(referenceId) + '/callback', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ status }),
          });
          const payload = await response.json();

          callbackResult.textContent = formatResult({
            action: status + '_CALLBACK',
            backendReferenceId: referenceId,
            httpStatus: response.status,
            response: payload,
          });

          await loadReferences();
        } catch (error) {
          callbackResult.textContent = formatResult({
            action: status + '_CALLBACK',
            backendReferenceId: referenceId,
            error: error instanceof Error ? error.message : String(error),
          });
        } finally {
          setBusy(false);
        }
      }

      function setBusy(nextBusy, activeButton) {
        busy = nextBusy;
        refreshButton.disabled = nextBusy;

        for (const button of document.querySelectorAll('button[data-action="callback"]')) {
          button.disabled = nextBusy;
        }

        if (activeButton instanceof HTMLButtonElement) {
          activeButton.disabled = nextBusy;
        }
      }

      function formatResult(value) {
        return JSON.stringify(value, null, 2);
      }

      function escapeHtml(value) {
        return String(value)
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#39;');
      }

      loadReferences();
    </script>
  </body>
</html>`;
}
