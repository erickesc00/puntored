import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildProviderStubApp } from '../src/app';

function createTempDbPath() {
  const dir = mkdtempSync(join(tmpdir(), 'provider-stub-'));
  return {
    dir,
    dbPath: join(dir, 'stub.db'),
  };
}

test('creates one provider reference per backend reference id', async (t) => {
  const temp = createTempDbPath();
  t.after(() => rmSync(temp.dir, { recursive: true, force: true }));

  const app = await buildProviderStubApp({
    env: {
      port: 3002,
      host: '127.0.0.1',
      databasePath: temp.dbPath,
      apiKey: 'stub-key',
      backendCallbackUrl: 'http://localhost:3000/api/provider/events',
      providerSharedSecret: 'provider-secret',
    },
    fetchImpl: async () => new Response(null, { status: 200 }),
  });
  t.after(async () => app.close());

  const payload = {
    backendReferenceId: 'ref-fixed-1',
    concept: 'Utility payment',
    amount: 125000,
    currency: 'cop',
    dueDate: '2026-08-20T10:00:00.000Z',
  };

  const firstResponse = await app.inject({
    method: 'POST',
    url: '/external-references',
    headers: { 'x-stub-api-key': 'stub-key' },
    payload,
  });
  const replayResponse = await app.inject({
    method: 'POST',
    url: '/external-references',
    headers: { 'x-stub-api-key': 'stub-key' },
    payload,
  });
  const listResponse = await app.inject({
    method: 'GET',
    url: '/external-references',
    headers: { 'x-stub-api-key': 'stub-key' },
  });

  assert.equal(firstResponse.statusCode, 200);
  assert.equal(replayResponse.statusCode, 200);
  assert.deepEqual(replayResponse.json(), firstResponse.json());
  assert.deepEqual(listResponse.json(), {
    items: [
      {
        ...firstResponse.json(),
        currency: 'COP',
      },
    ],
  });
});

test('filters the stored provider list by status and backend reference id', async (t) => {
  const temp = createTempDbPath();
  t.after(() => rmSync(temp.dir, { recursive: true, force: true }));

  const app = await buildProviderStubApp({
    env: {
      port: 3002,
      host: '127.0.0.1',
      databasePath: temp.dbPath,
      apiKey: 'stub-key',
      backendCallbackUrl: 'http://localhost:3000/api/provider/events',
      providerSharedSecret: 'provider-secret',
    },
    fetchImpl: async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  });
  t.after(async () => app.close());

  await app.inject({
    method: 'POST',
    url: '/external-references',
    headers: { 'x-stub-api-key': 'stub-key' },
    payload: {
      backendReferenceId: 'ref-1',
      concept: 'Payment 1',
      amount: 100,
      currency: 'COP',
      dueDate: '2026-08-20T10:00:00.000Z',
    },
  });
  await app.inject({
    method: 'POST',
    url: '/external-references',
    headers: { 'x-stub-api-key': 'stub-key' },
    payload: {
      backendReferenceId: 'ref-2',
      concept: 'Payment 2',
      amount: 200,
      currency: 'COP',
      dueDate: '2026-08-21T10:00:00.000Z',
    },
  });
  await app.inject({
    method: 'POST',
    url: '/external-references/ref-2/callback',
    headers: { 'x-stub-api-key': 'stub-key' },
    payload: { status: 'PAID' },
  });

  const byStatus = await app.inject({
    method: 'GET',
    url: '/external-references?status=PAID',
    headers: { 'x-stub-api-key': 'stub-key' },
  });
  const byReference = await app.inject({
    method: 'GET',
    url: '/external-references?backendReferenceId=ref-1',
    headers: { 'x-stub-api-key': 'stub-key' },
  });

  assert.equal(byStatus.statusCode, 200);
  assert.equal(byReference.statusCode, 200);
  assert.equal(byStatus.json().items.length, 1);
  assert.equal(byStatus.json().items[0].backendReferenceId, 'ref-2');
  assert.equal(byStatus.json().items[0].status, 'PAID');
  assert.equal(byReference.json().items.length, 1);
  assert.equal(byReference.json().items[0].backendReferenceId, 'ref-1');
  assert.equal(byReference.json().items[0].status, 'PENDING');
});

test('guards callback triggers with x-stub-api-key and forwards provider auth to the backend callback', async (t) => {
  const temp = createTempDbPath();
  t.after(() => rmSync(temp.dir, { recursive: true, force: true }));

  const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const app = await buildProviderStubApp({
    env: {
      port: 3002,
      host: '127.0.0.1',
      databasePath: temp.dbPath,
      apiKey: 'stub-key',
      backendCallbackUrl: 'http://localhost:3000/api/provider/events',
      providerSharedSecret: 'provider-secret',
    },
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url: String(url), init });
      return new Response(JSON.stringify({ outcome: 'SUCCESS' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  t.after(async () => app.close());

  await app.inject({
    method: 'POST',
    url: '/external-references',
    headers: { 'x-stub-api-key': 'stub-key' },
    payload: {
      backendReferenceId: 'ref-auth-1',
      concept: 'Auth flow',
      amount: 500,
      currency: 'COP',
      dueDate: '2026-08-20T10:00:00.000Z',
    },
  });

  const unauthorized = await app.inject({
    method: 'POST',
    url: '/external-references/ref-auth-1/callback',
    payload: { status: 'CANCELLED' },
  });
  const authorized = await app.inject({
    method: 'POST',
    url: '/external-references/ref-auth-1/callback',
    headers: { 'x-stub-api-key': 'stub-key' },
    payload: { status: 'CANCELLED' },
  });

  assert.equal(unauthorized.statusCode, 401);
  assert.equal(authorized.statusCode, 200);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0]?.url, 'http://localhost:3000/api/provider/events');
  assert.equal(
    new Headers(fetchCalls[0]?.init?.headers).get('x-provider-secret'),
    'provider-secret',
  );
  assert.equal(authorized.json().reference.backendReferenceId, 'ref-auth-1');
  assert.equal(authorized.json().reference.status, 'CANCELLED');
  assert.deepEqual(authorized.json().callback, {
    statusCode: 200,
    body: { outcome: 'SUCCESS' },
  });
});

test('serves a minimal operator UI and lets it trigger callbacks without the stub api key', async (t) => {
  const temp = createTempDbPath();
  t.after(() => rmSync(temp.dir, { recursive: true, force: true }));

  const app = await buildProviderStubApp({
    env: {
      port: 3002,
      host: '127.0.0.1',
      databasePath: temp.dbPath,
      apiKey: 'stub-key',
      backendCallbackUrl: 'http://localhost:3000/api/provider/events',
      providerSharedSecret: 'provider-secret',
    },
    fetchImpl: async () =>
      new Response(JSON.stringify({ accepted: true, source: 'backend' }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
  });
  t.after(async () => app.close());

  await app.inject({
    method: 'POST',
    url: '/external-references',
    headers: { 'x-stub-api-key': 'stub-key' },
    payload: {
      backendReferenceId: 'ref-ui-1',
      concept: 'Operator UI flow',
      amount: 1500,
      currency: 'COP',
      dueDate: '2026-08-20T10:00:00.000Z',
    },
  });

  const htmlResponse = await app.inject({
    method: 'GET',
    url: '/operator',
  });
  const listResponse = await app.inject({
    method: 'GET',
    url: '/operator/references',
  });
  const callbackResponse = await app.inject({
    method: 'POST',
    url: '/operator/references/ref-ui-1/callback',
    payload: { status: 'PAID' },
  });

  assert.equal(htmlResponse.statusCode, 200);
  assert.match(htmlResponse.headers['content-type'] ?? '', /text\/html/);
  assert.match(htmlResponse.body, /Provider Stub Operator/);
  assert.match(htmlResponse.body, /Last callback result/);

  assert.equal(listResponse.statusCode, 200);
  assert.equal(listResponse.json().items.length, 1);
  assert.equal(listResponse.json().items[0].backendReferenceId, 'ref-ui-1');

  assert.equal(callbackResponse.statusCode, 200);
  assert.equal(callbackResponse.json().reference.status, 'PAID');
  assert.deepEqual(callbackResponse.json().callback, {
    statusCode: 202,
    body: { accepted: true, source: 'backend' },
  });
});

test('keeps the stored status unchanged when the backend rejects an operator callback', async (t) => {
  const temp = createTempDbPath();
  t.after(() => rmSync(temp.dir, { recursive: true, force: true }));

  const app = await buildProviderStubApp({
    env: {
      port: 3002,
      host: '127.0.0.1',
      databasePath: temp.dbPath,
      apiKey: 'stub-key',
      backendCallbackUrl: 'http://localhost:3000/api/provider/events',
      providerSharedSecret: 'provider-secret',
    },
    fetchImpl: async () =>
      new Response(JSON.stringify({ accepted: false, reason: 'duplicate event' }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      }),
  });
  t.after(async () => app.close());

  await app.inject({
    method: 'POST',
    url: '/external-references',
    headers: { 'x-stub-api-key': 'stub-key' },
    payload: {
      backendReferenceId: 'ref-ui-reject-1',
      concept: 'Rejected callback flow',
      amount: 1500,
      currency: 'COP',
      dueDate: '2026-08-20T10:00:00.000Z',
    },
  });

  const callbackResponse = await app.inject({
    method: 'POST',
    url: '/operator/references/ref-ui-reject-1/callback',
    payload: { status: 'PAID' },
  });
  const listResponse = await app.inject({
    method: 'GET',
    url: '/operator/references',
  });

  assert.equal(callbackResponse.statusCode, 200);
  assert.equal(callbackResponse.json().reference.backendReferenceId, 'ref-ui-reject-1');
  assert.equal(callbackResponse.json().reference.status, 'PENDING');
  assert.deepEqual(callbackResponse.json().callback, {
    statusCode: 409,
    body: { accepted: false, reason: 'duplicate event' },
  });
  assert.equal(listResponse.statusCode, 200);
  assert.equal(listResponse.json().items.length, 1);
  assert.equal(listResponse.json().items[0].backendReferenceId, 'ref-ui-reject-1');
  assert.equal(listResponse.json().items[0].status, 'PENDING');
});
