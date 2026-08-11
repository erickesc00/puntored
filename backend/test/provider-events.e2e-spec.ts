/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { INestApplication } from '@nestjs/common';
import { ReferenceCreatorActorType, ReferenceStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { ERROR_CODE } from '../src/shared/vocabulary/error-codes';
import { PROVIDER_EVENT_OUTCOME } from '../src/shared/vocabulary/provider-event-outcomes';
import { createRealTestApp } from './helpers/create-real-test-app';
import { getSeedUsers, resetTestDatabase } from './helpers/mysql-test-db';

describe('Provider event endpoints (e2e, real Prisma + MySQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let referenceExpirationService: Awaited<
    ReturnType<typeof createRealTestApp>
  >['referenceExpirationService'];
  let operatorUser: Awaited<ReturnType<typeof getSeedUsers>>['operator'];
  let supervisorUser: Awaited<ReturnType<typeof getSeedUsers>>['supervisor'];

  beforeAll(async () => {
    const realApp = await createRealTestApp();
    app = realApp.app;
    prisma = realApp.prisma;
    referenceExpirationService = realApp.referenceExpirationService;
  });

  beforeEach(async () => {
    await resetTestDatabase(prisma);

    const seededUsers = await getSeedUsers(prisma);
    operatorUser = seededUsers.operator;
    supervisorUser = seededUsers.supervisor;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  const getHttpServer = () =>
    app.getHttpServer() as Parameters<typeof request>[0];

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
    dueAt?: Date;
    status?: ReferenceStatus;
    version?: number;
    externalReference?: string | null;
  }) => {
    return prisma.paymentReference.create({
      data: {
        concept: 'Provider fixture reference',
        amount: BigInt(125000),
        currency: 'MXN',
        dueAt: overrides?.dueAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
        status: overrides?.status ?? ReferenceStatus.PENDING,
        version: overrides?.version ?? 1,
        creatorActorType: ReferenceCreatorActorType.USER,
        creatorActorId: operatorUser.id,
        createdBy: operatorUser.id,
        externalReference:
          overrides?.externalReference === undefined
            ? `EXT-${randomUUID().slice(0, 8).toUpperCase()}`
            : overrides.externalReference,
      },
    });
  };

  const createProviderOwnedReference = async () => {
    return prisma.paymentReference.create({
      data: {
        concept: 'Provider-owned fixture reference',
        amount: BigInt(64000),
        currency: 'MXN',
        dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        status: ReferenceStatus.PENDING,
        version: 1,
        creatorActorType: ReferenceCreatorActorType.PROVIDER,
        creatorActorId: 'provider:puntored',
        createdBy: null,
        externalReference: `EXT-${randomUUID().slice(0, 8).toUpperCase()}`,
      },
    });
  };

  const providerPayload = (
    referenceId: string,
    overrides?: Partial<Record<string, unknown>>,
  ) => ({
    providerEventId: `provider-event-${randomUUID()}`,
    referenceId,
    externalReference: `EXT-${randomUUID().slice(0, 8)}`,
    status: 'PAID',
    paidAt: new Date().toISOString(),
    ...overrides,
  });

  const providerSecret =
    process.env.PROVIDER_SHARED_SECRET ?? 'test-provider-secret-1234';

  it('rejects provider callbacks without the shared secret', async () => {
    const reference = await createPersistedReference();

    const response = await request(getHttpServer())
      .post('/api/provider/events')
      .send(providerPayload(reference.id))
      .expect(401);

    expect(response.body.code).toBe(ERROR_CODE.PROVIDER_UNAUTHORIZED);
  });

  it('keeps callbacks working for provider-created references that have no human creator', async () => {
    const reference = await createProviderOwnedReference();
    const payload = providerPayload(reference.id, {
      externalReference: reference.externalReference,
    });

    const response = await request(getHttpServer())
      .post('/api/provider/events')
      .set('x-provider-secret', providerSecret)
      .send(payload)
      .expect(200);

    expect(response.body.reference.createdBy.id).toBe('provider:puntored');
    const persistedReference = await prisma.paymentReference.findUniqueOrThrow({
      where: { id: reference.id },
    });
    expect(persistedReference.status).toBe(ReferenceStatus.PAID);
  });

  it('marks a pending reference as paid, persists provider idempotency evidence, and exposes provider metrics', async () => {
    const reference = await createPersistedReference();
    const payload = providerPayload(reference.id, {
      externalReference: reference.externalReference,
    });

    const response = await request(getHttpServer())
      .post('/api/provider/events')
      .set('x-provider-secret', providerSecret)
      .send(payload)
      .expect(200);

    expect(response.body).toMatchObject({
      providerEventId: payload.providerEventId,
      outcome: PROVIDER_EVENT_OUTCOME.SUCCESS,
      duplicate: false,
      reference: {
        id: reference.id,
        status: ReferenceStatus.PAID,
        version: 2,
        externalReference: reference.externalReference,
      },
    });

    const persistedReference = await prisma.paymentReference.findUniqueOrThrow({
      where: { id: reference.id },
    });
    const providerEvents = await prisma.providerEvent.findMany();
    const auditRows = await prisma.auditEvent.findMany({
      where: { referenceId: reference.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    expect(persistedReference.status).toBe(ReferenceStatus.PAID);
    expect(persistedReference.version).toBe(2);
    expect(persistedReference.externalReference).toBe(
      reference.externalReference,
    );
    expect(providerEvents).toHaveLength(1);
    expect(providerEvents[0]).toMatchObject({
      providerEventId: payload.providerEventId,
      referenceId: reference.id,
      outcome: PROVIDER_EVENT_OUTCOME.SUCCESS,
      eventType: 'PAID',
    });
    expect(auditRows.map((row) => `${row.action}:${row.result}`)).toEqual([
      'PROVIDER_EVENT:SUCCESS',
    ]);

    const metricsResponse = await request(getHttpServer())
      .get('/api/metrics')
      .expect(200);

    expect(metricsResponse.text).toContain('puntored_provider_events_total');
    expect(metricsResponse.text).toContain('outcome="SUCCESS"');
  });

  it('suppresses duplicate provider events and returns a repeat-safe response', async () => {
    const reference = await createPersistedReference();
    const payload = providerPayload(reference.id, {
      externalReference: reference.externalReference,
    });

    await request(getHttpServer())
      .post('/api/provider/events')
      .set('x-provider-secret', providerSecret)
      .send(payload)
      .expect(200);

    const duplicateResponse = await request(getHttpServer())
      .post('/api/provider/events')
      .set('x-provider-secret', providerSecret)
      .send(payload)
      .expect(200);

    expect(duplicateResponse.body).toMatchObject({
      providerEventId: payload.providerEventId,
      outcome: PROVIDER_EVENT_OUTCOME.DUPLICATE,
      duplicate: true,
      reference: {
        id: reference.id,
        status: ReferenceStatus.PAID,
      },
    });

    const providerEvents = await prisma.providerEvent.findMany();
    const auditRows = await prisma.auditEvent.findMany({
      where: { referenceId: reference.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    expect(providerEvents).toHaveLength(1);
    expect(auditRows.map((row) => `${row.action}:${row.result}`)).toEqual([
      'PROVIDER_EVENT:SUCCESS',
      'PROVIDER_EVENT_REPLAY:DUPLICATE',
    ]);
  });

  it('rejects a late paid event after local cancellation and preserves audit evidence', async () => {
    const supervisorCookie = await createSessionCookie(supervisorUser.id);
    const reference = await createPersistedReference();

    await request(getHttpServer())
      .post(`/api/references/${reference.id}/cancel`)
      .set('Cookie', supervisorCookie)
      .send({ version: 1 })
      .expect(201);

    const payload = providerPayload(reference.id, {
      externalReference: reference.externalReference,
    });

    const conflictResponse = await request(getHttpServer())
      .post('/api/provider/events')
      .set('x-provider-secret', providerSecret)
      .send(payload)
      .expect(409);

    expect(conflictResponse.body.code).toBe(ERROR_CODE.PROVIDER_EVENT_CONFLICT);

    const persistedReference = await prisma.paymentReference.findUniqueOrThrow({
      where: { id: reference.id },
    });
    const providerEvents = await prisma.providerEvent.findMany();
    const auditRows = await prisma.auditEvent.findMany({
      where: { referenceId: reference.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    expect(persistedReference.status).toBe(ReferenceStatus.CANCELLED);
    expect(persistedReference.version).toBe(2);
    expect(providerEvents).toHaveLength(1);
    expect(providerEvents[0]).toMatchObject({
      providerEventId: payload.providerEventId,
      referenceId: reference.id,
      outcome: PROVIDER_EVENT_OUTCOME.REJECTED_TERMINAL_STATE,
    });
    expect(auditRows.map((row) => `${row.action}:${row.result}`)).toEqual([
      'CANCEL_ATTEMPT:STARTED',
      'CANCEL_REFERENCE:SUCCESS',
      'PROVIDER_EVENT:REJECTED_TERMINAL_STATE',
    ]);
  });

  it('keeps a provider-paid reference paid when expiration runs after the winning transition', async () => {
    const dueAt = new Date(Date.now() + 60 * 60 * 1000);
    const reference = await createPersistedReference({
      dueAt,
      status: ReferenceStatus.PENDING,
      version: 1,
    });
    const payload = providerPayload(reference.id, {
      externalReference: reference.externalReference,
    });

    await request(getHttpServer())
      .post('/api/provider/events')
      .set('x-provider-secret', providerSecret)
      .send(payload)
      .expect(200);

    await expect(
      referenceExpirationService.runTick(
        new Date(dueAt.getTime() + 60 * 60 * 1000),
      ),
    ).resolves.toMatchObject({
      attempted: 0,
      expired: 0,
      skipped: 0,
    });

    const persistedReference = await prisma.paymentReference.findUniqueOrThrow({
      where: { id: reference.id },
    });
    const auditRows = await prisma.auditEvent.findMany({
      where: { referenceId: reference.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    expect(persistedReference.status).toBe(ReferenceStatus.PAID);
    expect(persistedReference.version).toBe(2);
    expect(auditRows.map((row) => `${row.action}:${row.result}`)).toEqual([
      'PROVIDER_EVENT:SUCCESS',
    ]);
  });

  it('keeps a cancelled reference cancelled when expiration runs after the winning transition', async () => {
    const supervisorCookie = await createSessionCookie(supervisorUser.id);
    const dueAt = new Date(Date.now() + 60 * 60 * 1000);
    const reference = await createPersistedReference({
      dueAt,
      status: ReferenceStatus.PENDING,
      version: 1,
    });

    await request(getHttpServer())
      .post(`/api/references/${reference.id}/cancel`)
      .set('Cookie', supervisorCookie)
      .send({ version: 1 })
      .expect(201);

    await expect(
      referenceExpirationService.runTick(
        new Date(dueAt.getTime() + 60 * 60 * 1000),
      ),
    ).resolves.toMatchObject({
      attempted: 0,
      expired: 0,
      skipped: 0,
    });

    const persistedReference = await prisma.paymentReference.findUniqueOrThrow({
      where: { id: reference.id },
    });
    const auditRows = await prisma.auditEvent.findMany({
      where: { referenceId: reference.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    expect(persistedReference.status).toBe(ReferenceStatus.CANCELLED);
    expect(persistedReference.version).toBe(2);
    expect(auditRows.map((row) => `${row.action}:${row.result}`)).toEqual([
      'CANCEL_ATTEMPT:STARTED',
      'CANCEL_REFERENCE:SUCCESS',
    ]);
  });

  it('keeps cancel-versus-paid races valid and auditable', async () => {
    const supervisorCookie = await createSessionCookie(supervisorUser.id);
    const reference = await createPersistedReference();
    const payload = providerPayload(reference.id, {
      externalReference: reference.externalReference,
    });

    const [providerResult, cancelResult] = await Promise.allSettled([
      request(getHttpServer())
        .post('/api/provider/events')
        .set('x-provider-secret', providerSecret)
        .send(payload),
      request(getHttpServer())
        .post(`/api/references/${reference.id}/cancel`)
        .set('Cookie', supervisorCookie)
        .send({ version: 1 }),
    ]);

    expect(providerResult.status).toBe('fulfilled');
    expect(cancelResult.status).toBe('fulfilled');

    if (
      providerResult.status !== 'fulfilled' ||
      cancelResult.status !== 'fulfilled'
    ) {
      throw new Error(
        'Expected both competing requests to produce HTTP responses',
      );
    }

    const responseStatuses = [
      providerResult.value.status,
      cancelResult.value.status,
    ];
    expect(responseStatuses).toContain(409);
    expect(
      responseStatuses.some((status) => status === 200 || status === 201),
    ).toBe(true);

    const persistedReference = await prisma.paymentReference.findUniqueOrThrow({
      where: { id: reference.id },
    });
    const providerEvents = await prisma.providerEvent.findMany();
    const auditRows = await prisma.auditEvent.findMany({
      where: { referenceId: reference.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    expect([ReferenceStatus.PAID, ReferenceStatus.CANCELLED]).toContain(
      persistedReference.status,
    );
    expect(persistedReference.version).toBe(2);
    expect(providerEvents).toHaveLength(1);
    expect(auditRows.length).toBeGreaterThanOrEqual(2);

    if (persistedReference.status === ReferenceStatus.PAID) {
      expect(providerResult.value.status).toBe(200);
      expect(cancelResult.value.status).toBe(409);
      expect(providerEvents[0]?.outcome).toMatch(
        /SUCCESS|ACCEPTED_ALREADY_PAID/,
      );
      expect(
        auditRows.some(
          (row) =>
            row.action === 'PROVIDER_EVENT' &&
            (
              [
                PROVIDER_EVENT_OUTCOME.SUCCESS,
                PROVIDER_EVENT_OUTCOME.ACCEPTED_ALREADY_PAID,
              ] as string[]
            ).includes(row.result),
        ),
      ).toBe(true);
      expect(
        auditRows.some(
          (row) =>
            row.action === 'CANCEL_REFERENCE' &&
            row.result === 'REJECTED_VERSION_CONFLICT',
        ),
      ).toBe(true);
    } else {
      expect(providerResult.value.status).toBe(409);
      expect(cancelResult.value.status).toBe(201);
      expect(providerEvents[0]?.outcome).toBe(
        PROVIDER_EVENT_OUTCOME.REJECTED_TERMINAL_STATE,
      );
      expect(
        auditRows.some(
          (row) =>
            row.action === 'CANCEL_REFERENCE' && row.result === 'SUCCESS',
        ),
      ).toBe(true);
      expect(
        auditRows.some(
          (row) =>
            row.action === 'PROVIDER_EVENT' &&
            row.result === 'REJECTED_TERMINAL_STATE',
        ),
      ).toBe(true);
    }
  });

  it('marks a pending reference as cancelled through the provider callback path', async () => {
    const reference = await createPersistedReference();
    const payload = providerPayload(reference.id, {
      externalReference: reference.externalReference,
      status: 'CANCELLED',
      paidAt: undefined,
      occurredAt: new Date().toISOString(),
    });

    const response = await request(getHttpServer())
      .post('/api/provider/events')
      .set('x-provider-secret', providerSecret)
      .send(payload)
      .expect(200);

    expect(response.body).toMatchObject({
      providerEventId: payload.providerEventId,
      outcome: PROVIDER_EVENT_OUTCOME.SUCCESS,
      duplicate: false,
      reference: {
        id: reference.id,
        status: ReferenceStatus.CANCELLED,
        version: 2,
        externalReference: reference.externalReference,
      },
    });

    const persistedReference = await prisma.paymentReference.findUniqueOrThrow({
      where: { id: reference.id },
    });
    const auditRows = await prisma.auditEvent.findMany({
      where: { referenceId: reference.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    expect(persistedReference.status).toBe(ReferenceStatus.CANCELLED);
    expect(auditRows.map((row) => `${row.action}:${row.result}`)).toEqual([
      'PROVIDER_EVENT:SUCCESS',
    ]);
  });

  it('suppresses duplicate provider cancelled callbacks safely', async () => {
    const reference = await createPersistedReference();
    const payload = providerPayload(reference.id, {
      externalReference: reference.externalReference,
      status: 'CANCELLED',
      paidAt: undefined,
      occurredAt: new Date().toISOString(),
    });

    await request(getHttpServer())
      .post('/api/provider/events')
      .set('x-provider-secret', providerSecret)
      .send(payload)
      .expect(200);

    const duplicateResponse = await request(getHttpServer())
      .post('/api/provider/events')
      .set('x-provider-secret', providerSecret)
      .send(payload)
      .expect(200);

    expect(duplicateResponse.body).toMatchObject({
      providerEventId: payload.providerEventId,
      outcome: 'DUPLICATE',
      duplicate: true,
      reference: {
        id: reference.id,
        status: ReferenceStatus.CANCELLED,
      },
    });
  });

  it('rejects provider cancelled when the reference is already paid', async () => {
    const reference = await createPersistedReference({
      status: ReferenceStatus.PAID,
      version: 2,
    });
    const payload = providerPayload(reference.id, {
      externalReference: reference.externalReference,
      status: 'CANCELLED',
      paidAt: undefined,
      occurredAt: new Date().toISOString(),
    });

    const conflictResponse = await request(getHttpServer())
      .post('/api/provider/events')
      .set('x-provider-secret', providerSecret)
      .send(payload)
      .expect(409);

    expect(conflictResponse.body.code).toBe(ERROR_CODE.PROVIDER_EVENT_CONFLICT);

    const persistedReference = await prisma.paymentReference.findUniqueOrThrow({
      where: { id: reference.id },
    });

    expect(persistedReference.status).toBe(ReferenceStatus.PAID);
    expect(persistedReference.version).toBe(2);
  });

  it('rejects provider callbacks when the external reference mismatches persisted data', async () => {
    const reference = await createPersistedReference({
      externalReference: 'EXT-MATCH-001',
    });
    const payload = providerPayload(reference.id, {
      externalReference: 'EXT-OTHER-999',
      status: 'CANCELLED',
      paidAt: undefined,
      occurredAt: new Date().toISOString(),
    });

    const conflictResponse = await request(getHttpServer())
      .post('/api/provider/events')
      .set('x-provider-secret', providerSecret)
      .send(payload)
      .expect(409);

    expect(conflictResponse.body.code).toBe(
      ERROR_CODE.PROVIDER_EXTERNAL_REFERENCE_CONFLICT,
    );
  });
});
