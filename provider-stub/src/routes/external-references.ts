import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  providerReferenceStatuses,
  type ProviderReferenceRepository,
  type ProviderReferenceStatus,
} from '../db/sqlite';

const supportedProviderCreateCurrencies = ['COP', 'MXN', 'USD', 'EUR'] as const;
type SupportedProviderCreateCurrency =
  (typeof supportedProviderCreateCurrencies)[number];

export interface ProviderStubRouteConfig {
  apiKey: string;
  backendCreateUrl: string;
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

  app.post(
    '/operator/references',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: [
            'externalReference',
            'concept',
            'amount',
            'currency',
            'dueDate',
          ],
          properties: {
            externalReference: { type: 'string', minLength: 1, maxLength: 30 },
            concept: { type: 'string', minLength: 1, maxLength: 255 },
            amount: { type: 'string', minLength: 1, maxLength: 32 },
            currency: { type: 'string', minLength: 3, maxLength: 3 },
            dueDate: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as {
        externalReference: string;
        concept: string;
        amount: string;
        currency: string;
        dueDate: string;
      };

      const currency = body.currency.trim().toUpperCase();
      const amount = parseMinorUnits(body.amount);

      if (amount === null || amount < 1) {
        return reply.code(400).send({
          ok: false,
          error: {
            code: 'INVALID_OPERATOR_CREATE_AMOUNT',
            message:
              'Amount must be a positive major-unit value with up to two decimals',
          },
        });
      }

      if (!isSupportedProviderCreateCurrency(currency)) {
        return reply.code(400).send({
          ok: false,
          error: {
            code: 'INVALID_OPERATOR_CREATE_CURRENCY',
            message: `Currency must be one of ${supportedProviderCreateCurrencies.join(', ')}`,
          },
        });
      }

      const normalizedPayload = {
        externalReference: body.externalReference.trim(),
        concept: body.concept.trim(),
        amount,
        currency,
        dueDate: new Date(body.dueDate).toISOString(),
      };

      const backendResponse = await fetchImpl(config.backendCreateUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-provider-secret': config.providerSharedSecret,
        },
        body: JSON.stringify(normalizedPayload),
      });
      const backendBody = await safeReadBody(backendResponse);

      if (!backendResponse.ok) {
        return reply.code(200).send({
          ok: false,
          backend: {
            statusCode: backendResponse.status,
            body: backendBody,
          },
        });
      }

      const responseBody = backendBody as {
        id: string;
        externalReference: string;
        concept: string;
        amount: number;
        currency: string;
        dueDate: string;
      };
      const stored = config.repository.storeProviderCreated({
        backendReferenceId: responseBody.id,
        externalReference: responseBody.externalReference,
        concept: responseBody.concept,
        amount: responseBody.amount,
        currency: responseBody.currency,
        dueDate: responseBody.dueDate,
      });

      return reply.code(200).send({
        ok: true,
        reference: stored,
        backend: {
          statusCode: backendResponse.status,
          body: backendBody,
        },
      });
    },
  );

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
  const currencyOptions = supportedProviderCreateCurrencies
    .map((currency) => {
      const selected = currency === 'MXN' ? ' selected' : '';
      return `<option value="${currency}"${selected}>${currency}</option>`;
    })
    .join('');

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
      .form-grid,
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
      .form-grid {
        margin-top: 20px;
        padding: 16px;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      label {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 13px;
        color: #445067;
      }
      input,
      select {
        border: 1px solid #cbd5e1;
        border-radius: 10px;
        padding: 10px 12px;
        font: inherit;
        background: #fff;
      }
      .form-actions {
        grid-column: 1 / -1;
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
      }
      .inline-actions {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
      }
      .panel { overflow: hidden; }
      table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }
      th, td {
        padding: 14px 16px;
        border-bottom: 1px solid #e5eaf3;
        text-align: left;
        vertical-align: top;
        font-size: 14px;
        overflow-wrap: anywhere;
      }
      th {
        background: #f8fafc;
        color: #445067;
      }
      tr:last-child td { border-bottom: 0; }
      .actions-cell {
        width: 132px;
      }
      .actions {
        display: grid;
        grid-template-columns: 1fr;
        gap: 8px;
      }
      .actions button {
        width: 100%;
        min-width: 0;
        white-space: normal;
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
      code {
        font-family: ui-monospace, SFMono-Regular, monospace;
        overflow-wrap: anywhere;
      }
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

      <section class="panel form-grid">
        <label>
          External reference
          <input id="create-external-reference" type="text" maxlength="30" placeholder="EXT-PROVIDER-001" />
        </label>
        <label>
          Concept
          <input id="create-concept" type="text" maxlength="255" placeholder="Utility payment" />
        </label>
        <label>
          Amount
          <input id="create-amount" type="number" min="0.01" step="0.01" value="1250.00" />
        </label>
        <label>
          Currency
          <select id="create-currency">${currencyOptions}</select>
        </label>
        <label>
          Due date
          <input id="create-due-date" type="datetime-local" />
        </label>
        <div class="form-actions">
          <button class="secondary" id="generate-reference-button" type="button">Generate random reference</button>
          <div class="inline-actions">
            <button class="primary" id="create-button" type="button">Create provider reference</button>
          </div>
        </div>
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
                <th class="actions-cell">Actions</th>
              </tr>
            </thead>
            <tbody id="references-table-body">
              <tr><td colspan="5" class="empty">Loading provider references...</td></tr>
            </tbody>
          </table>
        </div>

        <aside class="panel sidebar">
          <h2>Create result</h2>
          <pre id="create-result">Submit the form to create and store a provider-originated reference mapping.</pre>
          <div style="height: 16px"></div>
          <h2>Last callback result</h2>
          <pre id="callback-result">Trigger a callback to inspect the backend response.</pre>
        </aside>
      </section>
    </main>

    <script>
      const tableBody = document.getElementById('references-table-body');
      const createResult = document.getElementById('create-result');
      const callbackResult = document.getElementById('callback-result');
      const summary = document.getElementById('summary');
      const refreshButton = document.getElementById('refresh-button');
      const createButton = document.getElementById('create-button');
      const generateReferenceButton = document.getElementById('generate-reference-button');
      const externalReferenceInput = document.getElementById('create-external-reference');
      const conceptInput = document.getElementById('create-concept');
      const amountInput = document.getElementById('create-amount');
      const currencyInput = document.getElementById('create-currency');
      const dueDateInput = document.getElementById('create-due-date');
      let busy = false;

      refreshButton.addEventListener('click', () => loadReferences());
      createButton.addEventListener('click', () => createReference());
      generateReferenceButton.addEventListener('click', () => {
        externalReferenceInput.value = buildRandomExternalReference();
      });

      dueDateInput.value = toDatetimeLocal(new Date(Date.now() + 24 * 60 * 60 * 1000));
      externalReferenceInput.value = buildRandomExternalReference();

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

      async function createReference() {
        setBusy(true, createButton);
        createResult.textContent = 'Creating provider reference...';

        try {
          const response = await fetch('/operator/references', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              externalReference: externalReferenceInput.value,
              concept: conceptInput.value,
              amount: amountInput.value,
              currency: currencyInput.value,
              dueDate: new Date(dueDateInput.value).toISOString(),
            }),
          });
          const payload = await response.json();
          createResult.textContent = formatResult(payload);

          if (payload.ok) {
            await loadReferences();
          }
        } catch (error) {
          createResult.textContent = formatResult({
            action: 'CREATE_PROVIDER_REFERENCE',
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
            '<td class="actions-cell">',
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
        createButton.disabled = nextBusy;
        generateReferenceButton.disabled = nextBusy;

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

      function toDatetimeLocal(value) {
        const pad = (part) => String(part).padStart(2, '0');
        return value.getFullYear() + '-' +
          pad(value.getMonth() + 1) + '-' +
          pad(value.getDate()) + 'T' +
          pad(value.getHours()) + ':' +
          pad(value.getMinutes());
      }

      function buildRandomExternalReference() {
        const suffix = Math.random().toString(36).slice(2, 10).toUpperCase();
        return 'EXT-' + suffix;
      }

      loadReferences();
    </script>
  </body>
</html>`;
}

function parseMinorUnits(value: string) {
  const normalized = value.trim().replace(',', '.');

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return null;
  }

  const [whole, decimal = ''] = normalized.split('.');
  return Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
}

function isSupportedProviderCreateCurrency(
  value: string,
): value is SupportedProviderCreateCurrency {
  return supportedProviderCreateCurrencies.includes(
    value as SupportedProviderCreateCurrency,
  );
}
