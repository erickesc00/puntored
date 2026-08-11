/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { ReferenceCreatorActorType, ReferenceStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { DEMO_REFERENCE_FIXTURES, seedDatabase } from '../prisma/seed';
import { createRealTestApp } from './helpers/create-real-test-app';
import { MockProviderStub } from './helpers/mock-provider-stub';
import { getSeedUsers, resetTestDatabase } from './helpers/mysql-test-db';

describe('Reference endpoints (e2e, real Prisma + MySQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let referenceExpirationService: Awaited<
    ReturnType<typeof createRealTestApp>
  >['referenceExpirationService'];
  let operatorUser: Awaited<ReturnType<typeof getSeedUsers>>['operator'];
  let supervisorUser: Awaited<ReturnType<typeof getSeedUsers>>['supervisor'];
  const providerStub = new MockProviderStub('test-stub-api-key');

  beforeAll(async () => {
    process.env.PROVIDER_STUB_API_KEY = providerStub.apiKey;
    await providerStub.start();
    process.env.PROVIDER_STUB_BASE_URL = providerStub.baseUrl;
    const realApp = await createRealTestApp();
    app = realApp.app;
    prisma = realApp.prisma;
    referenceExpirationService = realApp.referenceExpirationService;
  });

  beforeEach(async () => {
    providerStub.reset();
    await resetTestDatabase(prisma);

    const seededUsers = await getSeedUsers(prisma);
    operatorUser = seededUsers.operator;
    supervisorUser = seededUsers.supervisor;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }

    await providerStub.stop();
  });

  const getHttpServer = () =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const buildCreatePayload = (
    overrides?: Partial<Record<string, unknown>>,
  ) => ({
    concept: 'Pago de servicio público',
    amount: 125000,
    currency: 'MXN',
    dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  });

  const createSessionCookie = async (userId: string) => {
    const sessionId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);
    const absoluteExpiresAt = new Date(now.getTime() + 8 * 60 * 60 * 1000);

    await prisma.session.create({
      data: {
        id: sessionId,
        userId,
        expiresAt,
        absoluteExpiresAt,
        lastSeenAt: now,
      },
    });

    return `puntored.sid=${sessionId}`;
  };

  const createPersistedReference = async (overrides?: {
    concept?: string;
    amount?: bigint;
    currency?: string;
    dueAt?: Date;
    status?: ReferenceStatus;
    version?: number;
    createdAt?: Date;
    updatedAt?: Date;
    externalReference?: string | null;
  }) => {
    const createdAt = overrides?.createdAt ?? new Date();

    return prisma.paymentReference.create({
      data: {
        concept: overrides?.concept ?? 'Reference fixture',
        amount: overrides?.amount ?? BigInt(50000),
        currency: overrides?.currency ?? 'MXN',
        dueAt: overrides?.dueAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
        status: overrides?.status ?? ReferenceStatus.PENDING,
        version: overrides?.version ?? 1,
        creatorActorType: ReferenceCreatorActorType.USER,
        creatorActorId: operatorUser.id,
        createdBy: operatorUser.id,
        createdAt,
        updatedAt: overrides?.updatedAt ?? createdAt,
        externalReference:
          overrides?.externalReference === undefined
            ? null
            : overrides.externalReference,
      },
    });
  };

  const buildProviderCreatePayload = (
    overrides?: Partial<Record<string, unknown>>,
  ) => ({
    externalReference: 'provider-create-001',
    concept: 'Provider portal payment',
    amount: 88000,
    currency: 'MXN',
    dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  });

  const getMetricsText = async () => {
    const response = await request(getHttpServer())
      .get('/api/metrics')
      .expect(200);
    return response.text;
  };

  const providerSecret =
    process.env.PROVIDER_SHARED_SECRET ?? 'test-provider-secret-1234';

  it('creates provider-originated references without changing the internal create path', async () => {
    const response = await request(getHttpServer())
      .post('/api/provider/references')
      .set('x-provider-secret', providerSecret)
      .send(buildProviderCreatePayload())
      .expect(201);

    expect(response.body).toMatchObject({
      externalReference: 'PROVIDER-CREATE-001',
      creatorActorType: ReferenceCreatorActorType.PROVIDER,
      creatorActorId: 'provider:puntored',
      status: ReferenceStatus.PENDING,
    });

    const persistedReference = await prisma.paymentReference.findUniqueOrThrow({
      where: { id: response.body.id as string },
    });

    expect(persistedReference.creatorActorType).toBe(
      ReferenceCreatorActorType.PROVIDER,
    );
    expect(persistedReference.creatorActorId).toBe('provider:puntored');
    expect(persistedReference.createdBy).toBeNull();
  });

  it('replays provider creates for the same normalized immutable payload and returns the original mapping', async () => {
    const payload = buildProviderCreatePayload({
      externalReference: 'provider-replay-001',
      concept: '  Provider replay concept  ',
    });

    const firstResponse = await request(getHttpServer())
      .post('/api/provider/references')
      .set('x-provider-secret', providerSecret)
      .send(payload)
      .expect(201);

    const replayResponse = await request(getHttpServer())
      .post('/api/provider/references')
      .set('x-provider-secret', providerSecret)
      .send({
        ...payload,
        externalReference: ' provider-replay-001 ',
        concept: 'Provider   replay   concept',
      })
      .expect(200);

    expect(replayResponse.body).toMatchObject(firstResponse.body);
    expect(await prisma.paymentReference.count()).toBe(1);
  });

  it('rejects provider creates that reuse an external reference with conflicting immutable data', async () => {
    await request(getHttpServer())
      .post('/api/provider/references')
      .set('x-provider-secret', providerSecret)
      .send(
        buildProviderCreatePayload({
          externalReference: 'provider-conflict-001',
        }),
      )
      .expect(201);

    const response = await request(getHttpServer())
      .post('/api/provider/references')
      .set('x-provider-secret', providerSecret)
      .send(
        buildProviderCreatePayload({
          externalReference: 'provider-conflict-001',
          amount: 99000,
        }),
      )
      .expect(409);

    expect(response.body.code).toBe('PROVIDER_EXTERNAL_REFERENCE_CONFLICT');
    expect(await prisma.paymentReference.count()).toBe(1);
  });

  it('rejects provider create requests without provider auth', async () => {
    await request(getHttpServer())
      .post('/api/provider/references')
      .send(buildProviderCreatePayload())
      .expect(401);
  });

  it('replays the same logical result for the same idempotency key and payload, with persisted evidence', async () => {
    const operatorCookie = await createSessionCookie(operatorUser.id);
    const payload = buildCreatePayload();

    const idempotencyKey = `same-key-replay-${randomUUID()}`;

    const firstResponse = await request(getHttpServer())
      .post('/api/references')
      .set('Cookie', operatorCookie)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload)
      .expect(201);

    const replayResponse = await request(getHttpServer())
      .post('/api/references')
      .set('Cookie', operatorCookie)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload)
      .expect(201);

    expect(replayResponse.body.id).toBe(firstResponse.body.id);
    expect(replayResponse.body).toMatchObject(firstResponse.body);
    expect(firstResponse.body.externalReference).toBeTruthy();

    const persistedReference = await prisma.paymentReference.findUniqueOrThrow({
      where: { id: firstResponse.body.id as string },
    });
    const idempotencyRows = await prisma.idempotencyKey.findMany();
    const auditRows = await prisma.auditEvent.findMany({
      where: { referenceId: persistedReference.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    expect(persistedReference.status).toBe(ReferenceStatus.PENDING);
    expect(persistedReference.version).toBe(1);
    expect(persistedReference.externalReference).toBe(
      firstResponse.body.externalReference,
    );
    expect(idempotencyRows).toHaveLength(1);
    expect(providerStub.listRecords()).toHaveLength(1);
    expect(idempotencyRows[0]).toMatchObject({
      actorId: operatorUser.id,
      idempotencyKey,
      referenceId: persistedReference.id,
      responseCode: 201,
    });
    expect(auditRows.map((row) => `${row.action}:${row.result}`)).toEqual([
      'CREATE_REFERENCE:SUCCESS',
      'IDEMPOTENT_REPLAY:SUCCESS',
    ]);
  });

  it('rejects the same idempotency key with a different payload and keeps a single persisted reference', async () => {
    const operatorCookie = await createSessionCookie(operatorUser.id);
    const idempotencyKey = `same-key-conflict-${randomUUID()}`;

    const firstPayload = buildCreatePayload({ concept: 'Pago inicial' });

    const createdResponse = await request(getHttpServer())
      .post('/api/references')
      .set('Cookie', operatorCookie)
      .set('Idempotency-Key', idempotencyKey)
      .send(firstPayload)
      .expect(201);

    const conflictResponse = await request(getHttpServer())
      .post('/api/references')
      .set('Cookie', operatorCookie)
      .set('Idempotency-Key', idempotencyKey)
      .send(buildCreatePayload({ concept: 'Pago distinto' }))
      .expect(409);

    expect(conflictResponse.body.code).toBe('IDEMPOTENCY_CONFLICT');

    const paymentReferences = await prisma.paymentReference.findMany();
    const idempotencyRows = await prisma.idempotencyKey.findMany();
    const auditRows = await prisma.auditEvent.findMany({
      where: { referenceId: createdResponse.body.id as string },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    expect(paymentReferences).toHaveLength(1);
    expect(paymentReferences[0]?.externalReference).toBeTruthy();
    expect(idempotencyRows).toHaveLength(1);
    expect(auditRows.map((row) => `${row.action}:${row.result}`)).toEqual([
      'CREATE_REFERENCE:SUCCESS',
      'CREATE_REFERENCE:REJECTED_IDEMPOTENCY_CONFLICT',
    ]);

    const metricsText = await getMetricsText();
    expect(metricsText).toContain('puntored_reference_create_total');
    expect(metricsText).toContain('outcome="success"');
    expect(metricsText).toContain('outcome="rejected_idempotency_conflict"');
  });

  it('fails create when provider allocation fails and leaves no local-only reference row', async () => {
    const operatorCookie = await createSessionCookie(operatorUser.id);
    providerStub.failNextAllocation(503, {
      code: 'STUB_DOWN',
      message: 'Provider stub unavailable',
    });

    const response = await request(getHttpServer())
      .post('/api/references')
      .set('Cookie', operatorCookie)
      .set('Idempotency-Key', `alloc-failure-${randomUUID()}`)
      .send(buildCreatePayload({ concept: 'Provider failure case' }))
      .expect(503);

    expect(response.body.code).toBe('PROVIDER_ALLOCATION_FAILED');
    expect(await prisma.paymentReference.count()).toBe(0);
    expect(await prisma.idempotencyKey.count()).toBe(0);
    expect(providerStub.listRecords()).toHaveLength(0);
  });

  it.each(['MXN', 'COP', 'USD', 'EUR'])(
    'creates references with supported currency %s',
    async (currency) => {
      const operatorCookie = await createSessionCookie(operatorUser.id);

      const response = await request(getHttpServer())
        .post('/api/references')
        .set('Cookie', operatorCookie)
        .set('Idempotency-Key', `supported-${currency}-${randomUUID()}`)
        .send(buildCreatePayload({ currency }))
        .expect(201);

      expect(response.body.currency).toBe(currency);

      const persistedReference =
        await prisma.paymentReference.findUniqueOrThrow({
          where: { id: response.body.id as string },
          select: { currency: true },
        });

      expect(persistedReference.currency).toBe(currency);
    },
  );

  it.each(['JPY', 'XYZ', 'mxn'])(
    'rejects unsupported or non-canonical currency %s with a 400',
    async (currency) => {
      const operatorCookie = await createSessionCookie(operatorUser.id);

      const response = await request(getHttpServer())
        .post('/api/references')
        .set('Cookie', operatorCookie)
        .set('Idempotency-Key', `invalid-${String(currency)}-${randomUUID()}`)
        .send(buildCreatePayload({ currency }))
        .expect(400);

      expect(response.body.code).toBe('BAD_REQUEST');
      expect(response.body.message).toBe('Validation failed');
      expect(response.body.details).toEqual(
        expect.arrayContaining([
          'currency must be one of the following values: COP, MXN, USD, EUR',
        ]),
      );
      expect(await prisma.paymentReference.count()).toBe(0);
    },
  );

  it('rejects missing currency with a 400 instead of a downstream 500', async () => {
    const operatorCookie = await createSessionCookie(operatorUser.id);

    const payload = buildCreatePayload();
    delete (payload as { currency?: string }).currency;

    const response = await request(getHttpServer())
      .post('/api/references')
      .set('Cookie', operatorCookie)
      .set('Idempotency-Key', `missing-currency-${randomUUID()}`)
      .send(payload)
      .expect(400);

    expect(response.body.code).toBe('BAD_REQUEST');
    expect(response.body.message).toBe('Validation failed');
    expect(response.body.details).toEqual(
      expect.arrayContaining(['currency should not be null or undefined']),
    );
    expect(await prisma.paymentReference.count()).toBe(0);
  });

  it('recovers safely when provider allocation succeeds before local persistence fails and the caller retries', async () => {
    const operatorCookie = await createSessionCookie(operatorUser.id);
    const idempotencyKey = `retry-after-provider-success-${randomUUID()}`;
    const payload = buildCreatePayload({
      concept: 'Retry after local failure',
    });
    const originalTransaction = prisma.$transaction.bind(prisma);
    let firstTransactionAttempt = true;

    const transactionSpy = jest
      .spyOn(prisma, '$transaction')
      .mockImplementation((...args: Parameters<typeof prisma.$transaction>) => {
        if (firstTransactionAttempt) {
          firstTransactionAttempt = false;
          return Promise.reject(new Error('forced local persistence failure'));
        }

        return originalTransaction(...args);
      });

    await request(getHttpServer())
      .post('/api/references')
      .set('Cookie', operatorCookie)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload)
      .expect(500);

    const retryResponse = await request(getHttpServer())
      .post('/api/references')
      .set('Cookie', operatorCookie)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload)
      .expect(201);

    expect(providerStub.listRecords()).toHaveLength(1);
    expect(retryResponse.body.externalReference).toBe(
      providerStub.listRecords()[0]?.externalReference,
    );

    const persistedReference = await prisma.paymentReference.findUniqueOrThrow({
      where: { id: retryResponse.body.id as string },
    });

    expect(persistedReference.externalReference).toBe(
      retryResponse.body.externalReference,
    );
    expect(await prisma.idempotencyKey.count()).toBe(1);

    transactionSpy.mockRestore();
  });

  it('persists overdue pending references as expired and increments version exactly once', async () => {
    const operatorCookie = await createSessionCookie(operatorUser.id);
    const overdueReference = await createPersistedReference({
      concept: 'Overdue pending reference',
      dueAt: new Date('2026-08-01T10:00:00.000Z'),
      status: ReferenceStatus.PENDING,
      version: 1,
    });
    const tickNow = new Date('2026-08-01T11:00:00.000Z');

    await expect(
      referenceExpirationService.runTick(tickNow),
    ).resolves.toMatchObject({
      attempted: 1,
      expired: 1,
      skipped: 0,
    });

    const persistedReference = await prisma.paymentReference.findUniqueOrThrow({
      where: { id: overdueReference.id },
    });
    const auditRows = await prisma.auditEvent.findMany({
      where: { referenceId: overdueReference.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    expect(persistedReference.status).toBe(ReferenceStatus.EXPIRED);
    expect(persistedReference.version).toBe(2);
    expect(auditRows.map((row) => `${row.action}:${row.result}`)).toEqual([
      'EXPIRE_REFERENCE:SUCCESS',
    ]);
    expect(auditRows[0]?.metadataJson).toMatchObject({
      previousVersion: 1,
      newVersion: 2,
      dueAt: overdueReference.dueAt.toISOString(),
    });

    const detailResponse = await request(getHttpServer())
      .get(`/api/references/${overdueReference.id}`)
      .set('Cookie', operatorCookie)
      .expect(200);

    expect(detailResponse.body.reference).toMatchObject({
      id: overdueReference.id,
      status: ReferenceStatus.EXPIRED,
      version: 2,
    });
  });

  it('leaves non-overdue and terminal references unchanged during expiration evaluation', async () => {
    const futurePending = await createPersistedReference({
      concept: 'Future pending reference',
      dueAt: new Date('2026-08-01T13:00:00.000Z'),
      status: ReferenceStatus.PENDING,
      version: 3,
    });
    const paidReference = await createPersistedReference({
      concept: 'Paid reference',
      dueAt: new Date('2026-08-01T09:00:00.000Z'),
      status: ReferenceStatus.PAID,
      version: 4,
    });
    const cancelledReference = await createPersistedReference({
      concept: 'Cancelled reference',
      dueAt: new Date('2026-08-01T09:00:00.000Z'),
      status: ReferenceStatus.CANCELLED,
      version: 5,
    });
    const alreadyExpiredReference = await createPersistedReference({
      concept: 'Expired reference',
      dueAt: new Date('2026-08-01T09:00:00.000Z'),
      status: ReferenceStatus.EXPIRED,
      version: 6,
    });
    const tickNow = new Date('2026-08-01T11:00:00.000Z');

    await expect(
      referenceExpirationService.runTick(tickNow),
    ).resolves.toMatchObject({
      attempted: 0,
      expired: 0,
      skipped: 0,
    });

    const persistedReferences = await prisma.paymentReference.findMany({
      where: {
        id: {
          in: [
            futurePending.id,
            paidReference.id,
            cancelledReference.id,
            alreadyExpiredReference.id,
          ],
        },
      },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        status: true,
        version: true,
      },
    });

    expect(persistedReferences).toEqual(
      expect.arrayContaining([
        {
          id: alreadyExpiredReference.id,
          status: ReferenceStatus.EXPIRED,
          version: 6,
        },
        {
          id: cancelledReference.id,
          status: ReferenceStatus.CANCELLED,
          version: 5,
        },
        {
          id: futurePending.id,
          status: ReferenceStatus.PENDING,
          version: 3,
        },
        {
          id: paidReference.id,
          status: ReferenceStatus.PAID,
          version: 4,
        },
      ]),
    );

    const auditCount = await prisma.auditEvent.count({
      where: {
        referenceId: {
          in: [
            futurePending.id,
            paidReference.id,
            cancelledReference.id,
            alreadyExpiredReference.id,
          ],
        },
        action: 'EXPIRE_REFERENCE',
      },
    });

    expect(auditCount).toBe(0);
  });

  it('is idempotent across reruns and does not fabricate success audits for already expired rows', async () => {
    const overdueReference = await createPersistedReference({
      concept: 'Idempotent overdue reference',
      dueAt: new Date('2026-08-01T10:00:00.000Z'),
      status: ReferenceStatus.PENDING,
      version: 1,
    });
    const tickNow = new Date('2026-08-01T11:00:00.000Z');

    await expect(
      referenceExpirationService.runTick(tickNow),
    ).resolves.toMatchObject({
      attempted: 1,
      expired: 1,
      skipped: 0,
    });
    await expect(
      referenceExpirationService.runTick(tickNow),
    ).resolves.toMatchObject({
      attempted: 0,
      expired: 0,
      skipped: 0,
    });

    const persistedReference = await prisma.paymentReference.findUniqueOrThrow({
      where: { id: overdueReference.id },
    });
    const auditRows = await prisma.auditEvent.findMany({
      where: { referenceId: overdueReference.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    expect(persistedReference.status).toBe(ReferenceStatus.EXPIRED);
    expect(persistedReference.version).toBe(2);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      action: 'EXPIRE_REFERENCE',
      result: 'SUCCESS',
    });
  });

  it('keeps fallback reads exposing overdue pending references as expired during rollout', async () => {
    const operatorCookie = await createSessionCookie(operatorUser.id);
    const overduePending = await createPersistedReference({
      concept: 'Fallback overdue pending reference',
      dueAt: new Date('2026-08-01T10:00:00.000Z'),
      status: ReferenceStatus.PENDING,
      version: 1,
    });

    const detailResponse = await request(getHttpServer())
      .get(`/api/references/${overduePending.id}`)
      .set('Cookie', operatorCookie)
      .expect(200);

    const listResponse = await request(getHttpServer())
      .get('/api/references?status=EXPIRED')
      .set('Cookie', operatorCookie)
      .expect(200);

    const persistedReference = await prisma.paymentReference.findUniqueOrThrow({
      where: { id: overduePending.id },
    });

    expect(persistedReference.status).toBe(ReferenceStatus.PENDING);
    expect(detailResponse.body.reference).toMatchObject({
      id: overduePending.id,
      status: ReferenceStatus.EXPIRED,
      version: 1,
    });
    expect(
      listResponse.body.items.some(
        (item: { id: string; status: ReferenceStatus }) =>
          item.id === overduePending.id &&
          item.status === ReferenceStatus.EXPIRED,
      ),
    ).toBe(true);
  });

  it('filters the list by persisted status', async () => {
    const operatorCookie = await createSessionCookie(operatorUser.id);

    const pendingReference = await createPersistedReference({
      concept: 'Pending row',
      status: ReferenceStatus.PENDING,
    });
    const cancelledReference = await createPersistedReference({
      concept: 'Cancelled row',
      status: ReferenceStatus.CANCELLED,
    });

    const response = await request(getHttpServer())
      .get('/api/references?status=CANCELLED')
      .set('Cookie', operatorCookie)
      .expect(200);

    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({
      id: cancelledReference.id,
      status: ReferenceStatus.CANCELLED,
    });

    const persistedStatuses = await prisma.paymentReference.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, status: true },
    });

    expect(persistedStatuses).toEqual(
      expect.arrayContaining([
        { id: pendingReference.id, status: ReferenceStatus.PENDING },
        { id: cancelledReference.id, status: ReferenceStatus.CANCELLED },
      ]),
    );
  });

  it('filters the list by persisted createdAt date range', async () => {
    const operatorCookie = await createSessionCookie(operatorUser.id);

    const beforeRange = new Date('2026-08-01T10:00:00.000Z');
    const insideRange = new Date('2026-08-10T10:00:00.000Z');
    const afterRange = new Date('2026-08-20T10:00:00.000Z');

    const older = await createPersistedReference({
      concept: 'Older reference',
      createdAt: beforeRange,
      updatedAt: beforeRange,
    });
    const inRange = await createPersistedReference({
      concept: 'In range reference',
      createdAt: insideRange,
      updatedAt: insideRange,
    });
    const newer = await createPersistedReference({
      concept: 'Newer reference',
      createdAt: afterRange,
      updatedAt: afterRange,
    });

    const response = await request(getHttpServer())
      .get(
        '/api/references?createdFrom=2026-08-05T00:00:00.000Z&createdTo=2026-08-15T23:59:59.999Z',
      )
      .set('Cookie', operatorCookie)
      .expect(200);

    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].id).toBe(inRange.id);

    const persistedRangeRows = await prisma.paymentReference.findMany({
      where: {
        createdAt: {
          gte: new Date('2026-08-05T00:00:00.000Z'),
          lte: new Date('2026-08-15T23:59:59.999Z'),
        },
      },
      select: { id: true },
    });

    expect(persistedRangeRows).toEqual([{ id: inRange.id }]);
    expect([older.id, newer.id]).not.toContain(
      response.body.items[0].id as string,
    );
  });

  it('searches by persisted externalReference', async () => {
    const operatorCookie = await createSessionCookie(operatorUser.id);

    const matching = await createPersistedReference({
      concept: 'External reference search match',
      externalReference: 'EXT-SEARCH-001',
    });
    await createPersistedReference({
      concept: 'Other external reference',
      externalReference: 'EXT-OTHER-002',
    });

    const response = await request(getHttpServer())
      .get('/api/references?search=SEARCH-001')
      .set('Cookie', operatorCookie)
      .expect(200);

    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].id).toBe(matching.id);

    const persisted = await prisma.paymentReference.findUniqueOrThrow({
      where: { id: matching.id },
      select: { externalReference: true },
    });

    expect(persisted.externalReference).toBe('EXT-SEARCH-001');
  });

  it('searches by persisted concept', async () => {
    const operatorCookie = await createSessionCookie(operatorUser.id);

    const matching = await createPersistedReference({
      concept: 'Tuition August payment',
    });
    await createPersistedReference({
      concept: 'Utility bill payment',
    });

    const response = await request(getHttpServer())
      .get('/api/references?search=Tuition')
      .set('Cookie', operatorCookie)
      .expect(200);

    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].id).toBe(matching.id);

    const persisted = await prisma.paymentReference.findUniqueOrThrow({
      where: { id: matching.id },
      select: { concept: true },
    });

    expect(persisted.concept).toBe('Tuition August payment');
  });

  it('keeps pagination stable across cursor pages using persisted ordering', async () => {
    const operatorCookie = await createSessionCookie(operatorUser.id);

    const first = await createPersistedReference({
      concept: 'First',
      createdAt: new Date('2026-08-01T10:00:00.000Z'),
      updatedAt: new Date('2026-08-01T10:00:00.000Z'),
    });
    const second = await createPersistedReference({
      concept: 'Second',
      createdAt: new Date('2026-08-02T10:00:00.000Z'),
      updatedAt: new Date('2026-08-02T10:00:00.000Z'),
    });
    const third = await createPersistedReference({
      concept: 'Third',
      createdAt: new Date('2026-08-03T10:00:00.000Z'),
      updatedAt: new Date('2026-08-03T10:00:00.000Z'),
    });
    const fourth = await createPersistedReference({
      concept: 'Fourth',
      createdAt: new Date('2026-08-04T10:00:00.000Z'),
      updatedAt: new Date('2026-08-04T10:00:00.000Z'),
    });

    const firstPage = await request(getHttpServer())
      .get('/api/references?limit=2')
      .set('Cookie', operatorCookie)
      .expect(200);

    expect(firstPage.body.items.map((item: { id: string }) => item.id)).toEqual(
      [fourth.id, third.id],
    );
    expect(firstPage.body.pageInfo.nextCursor).toBeTruthy();

    const secondPage = await request(getHttpServer())
      .get(
        `/api/references?limit=2&cursor=${firstPage.body.pageInfo.nextCursor as string}`,
      )
      .set('Cookie', operatorCookie)
      .expect(200);

    expect(
      secondPage.body.items.map((item: { id: string }) => item.id),
    ).toEqual([second.id, first.id]);
    expect(secondPage.body.pageInfo.nextCursor).toBeNull();

    const persistedOrder = await prisma.paymentReference.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });

    expect(persistedOrder.map((item) => item.id)).toEqual([
      fourth.id,
      third.id,
      second.id,
      first.id,
    ]);
  });

  it('returns detail with persisted audit history', async () => {
    const operatorCookie = await createSessionCookie(operatorUser.id);
    const payload = buildCreatePayload({ concept: 'History check reference' });
    const idempotencyKey = `detail-history-key-${randomUUID()}`;

    const createdResponse = await request(getHttpServer())
      .post('/api/references')
      .set('Cookie', operatorCookie)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload)
      .expect(201);

    await request(getHttpServer())
      .post('/api/references')
      .set('Cookie', operatorCookie)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload)
      .expect(201);

    const detailResponse = await request(getHttpServer())
      .get(`/api/references/${createdResponse.body.id as string}`)
      .set('Cookie', operatorCookie)
      .expect(200);

    const auditRows = await prisma.auditEvent.findMany({
      where: { referenceId: createdResponse.body.id as string },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    expect(detailResponse.body.reference.id).toBe(createdResponse.body.id);
    expect(detailResponse.body.history).toHaveLength(2);
    expect(
      detailResponse.body.history.map(
        (entry: { action: string; result: string }) =>
          `${entry.action}:${entry.result}`,
      ),
    ).toEqual(auditRows.map((row) => `${row.action}:${row.result}`));
  });

  it('seeds canonical demo fixtures without duplicating references or audit history', async () => {
    await seedDatabase(prisma, { bcryptRounds: 4 });
    await seedDatabase(prisma, { bcryptRounds: 4 });

    const references = await prisma.paymentReference.findMany({
      where: {
        externalReference: {
          in: DEMO_REFERENCE_FIXTURES.map(
            (fixture) => fixture.externalReference,
          ),
        },
      },
      orderBy: { externalReference: 'asc' },
      select: {
        externalReference: true,
        currency: true,
        status: true,
        version: true,
      },
    });

    const auditCounts = await Promise.all(
      DEMO_REFERENCE_FIXTURES.map(async (fixture) => {
        const reference = await prisma.paymentReference.findUniqueOrThrow({
          where: { externalReference: fixture.externalReference },
          select: { id: true },
        });

        return {
          externalReference: fixture.externalReference,
          auditCount: await prisma.auditEvent.count({
            where: { referenceId: reference.id },
          }),
        };
      }),
    );

    expect(references).toEqual(
      DEMO_REFERENCE_FIXTURES.map((fixture) => ({
        externalReference: fixture.externalReference,
        currency: fixture.currency,
        status: fixture.status,
        version: fixture.history.length,
      })),
    );
    expect(auditCounts).toEqual(
      DEMO_REFERENCE_FIXTURES.map((fixture) => ({
        externalReference: fixture.externalReference,
        auditCount: fixture.history.length,
      })),
    );
  });

  it('cancels a persisted pending reference as supervisor and increments version', async () => {
    const operatorCookie = await createSessionCookie(operatorUser.id);
    const supervisorCookie = await createSessionCookie(supervisorUser.id);
    const idempotencyKey = `cancel-success-key-${randomUUID()}`;

    const createdResponse = await request(getHttpServer())
      .post('/api/references')
      .set('Cookie', operatorCookie)
      .set('Idempotency-Key', idempotencyKey)
      .send(buildCreatePayload({ concept: 'Cancelable reference' }))
      .expect(201);

    const cancelResponse = await request(getHttpServer())
      .post(`/api/references/${createdResponse.body.id as string}/cancel`)
      .set('Cookie', supervisorCookie)
      .send({ version: 1 })
      .expect(201);

    expect(cancelResponse.body).toMatchObject({
      id: createdResponse.body.id,
      status: ReferenceStatus.CANCELLED,
      version: 2,
    });

    const persistedReference = await prisma.paymentReference.findUniqueOrThrow({
      where: { id: createdResponse.body.id as string },
    });
    const auditRows = await prisma.auditEvent.findMany({
      where: { referenceId: persistedReference.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    expect(persistedReference.status).toBe(ReferenceStatus.CANCELLED);
    expect(persistedReference.version).toBe(2);
    expect(auditRows.map((row) => `${row.action}:${row.result}`)).toEqual([
      'CREATE_REFERENCE:SUCCESS',
      'CANCEL_ATTEMPT:STARTED',
      'CANCEL_REFERENCE:SUCCESS',
    ]);

    const metricsText = await getMetricsText();
    expect(metricsText).toContain('puntored_reference_cancel_total');
    expect(metricsText).toContain('outcome="success"');
  });

  it('rejects cancelling an already cancelled reference and persists the rejection audit trail', async () => {
    const operatorCookie = await createSessionCookie(operatorUser.id);
    const supervisorCookie = await createSessionCookie(supervisorUser.id);
    const idempotencyKey = `cancel-terminal-key-${randomUUID()}`;

    const createdResponse = await request(getHttpServer())
      .post('/api/references')
      .set('Cookie', operatorCookie)
      .set('Idempotency-Key', idempotencyKey)
      .send(buildCreatePayload({ concept: 'Already cancelled reference' }))
      .expect(201);

    await request(getHttpServer())
      .post(`/api/references/${createdResponse.body.id as string}/cancel`)
      .set('Cookie', supervisorCookie)
      .send({ version: 1 })
      .expect(201);

    const secondCancelResponse = await request(getHttpServer())
      .post(`/api/references/${createdResponse.body.id as string}/cancel`)
      .set('Cookie', supervisorCookie)
      .send({ version: 2 })
      .expect(409);

    expect(secondCancelResponse.body.code).toBe('INVALID_REFERENCE_STATE');

    const persistedReference = await prisma.paymentReference.findUniqueOrThrow({
      where: { id: createdResponse.body.id as string },
    });
    const auditRows = await prisma.auditEvent.findMany({
      where: { referenceId: persistedReference.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    expect(persistedReference.status).toBe(ReferenceStatus.CANCELLED);
    expect(persistedReference.version).toBe(2);
    expect(auditRows.map((row) => `${row.action}:${row.result}`)).toEqual([
      'CREATE_REFERENCE:SUCCESS',
      'CANCEL_ATTEMPT:STARTED',
      'CANCEL_REFERENCE:SUCCESS',
      'CANCEL_ATTEMPT:STARTED',
      'CANCEL_REFERENCE:REJECTED_INVALID_STATUS',
    ]);
    expect(auditRows[4]?.metadataJson).toMatchObject({
      expectedVersion: 2,
      currentVersion: 2,
      currentStatus: ReferenceStatus.CANCELLED,
    });
  });

  it('returns a conflict for stale cancel version and leaves persisted state untouched', async () => {
    const supervisorCookie = await createSessionCookie(
      (await getSeedUsers(prisma)).supervisor.id,
    );

    const reference = await createPersistedReference({
      concept: 'Stale version reference',
      status: ReferenceStatus.PENDING,
      version: 1,
    });

    await prisma.paymentReference.update({
      where: { id: reference.id },
      data: { version: 2 },
    });

    const conflictResponse = await request(getHttpServer())
      .post(`/api/references/${reference.id}/cancel`)
      .set('Cookie', supervisorCookie)
      .send({ version: 1 })
      .expect(409);

    expect(conflictResponse.body.code).toBe('REFERENCE_VERSION_CONFLICT');

    const persistedReference = await prisma.paymentReference.findUniqueOrThrow({
      where: { id: reference.id },
    });
    const auditRows = await prisma.auditEvent.findMany({
      where: { referenceId: reference.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    expect(persistedReference.status).toBe(ReferenceStatus.PENDING);
    expect(persistedReference.version).toBe(2);
    expect(auditRows.map((row) => `${row.action}:${row.result}`)).toEqual([
      'CANCEL_ATTEMPT:STARTED',
      'CANCEL_REFERENCE:REJECTED_VERSION_CONFLICT',
    ]);

    const metricsText = await getMetricsText();
    expect(metricsText).toContain('puntored_reference_cancel_total');
    expect(metricsText).toContain('outcome="rejected_version_conflict"');
  });

  it('forbids cancel for operator and preserves persisted state', async () => {
    const operatorCookie = await createSessionCookie(operatorUser.id);

    const reference = await createPersistedReference({
      concept: 'Operator forbidden reference',
      status: ReferenceStatus.PENDING,
      version: 1,
    });

    const forbiddenResponse = await request(getHttpServer())
      .post(`/api/references/${reference.id}/cancel`)
      .set('Cookie', operatorCookie)
      .send({ version: 1 })
      .expect(403);

    expect(forbiddenResponse.body.code).toBe('FORBIDDEN');

    const persistedReference = await prisma.paymentReference.findUniqueOrThrow({
      where: { id: reference.id },
    });
    const auditCount = await prisma.auditEvent.count({
      where: { referenceId: reference.id },
    });

    expect(persistedReference.status).toBe(ReferenceStatus.PENDING);
    expect(persistedReference.version).toBe(1);
    expect(auditCount).toBe(0);
  });
});
