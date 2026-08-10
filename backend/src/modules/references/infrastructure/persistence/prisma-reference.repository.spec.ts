import { AuditActorType, ReferenceStatus } from '@prisma/client';
import { AUDIT_ACTION } from '../../../../shared/vocabulary/audit-actions';
import { AUDIT_RESULT } from '../../../../shared/vocabulary/audit-results';
import { IDEMPOTENCY_SCOPE } from '../../../../shared/vocabulary/idempotency-scopes';
import { PrismaReferenceRepository } from './prisma-reference.repository';

describe('PrismaReferenceRepository', () => {
  const createRepository = () => {
    const tx = {
      paymentReference: {
        findMany: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
        findUnique: jest.fn(),
      },
      auditEvent: {
        create: jest.fn(),
      },
      idempotencyKey: {
        create: jest.fn(),
      },
    };

    const prisma = {
      idempotencyKey: {
        findUnique: jest.fn(),
      },
      paymentReference: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      auditEvent: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
      $transaction: jest.fn((callback: (txArg: typeof tx) => unknown) =>
        Promise.resolve(callback(tx)),
      ),
    };

    return {
      repository: new PrismaReferenceRepository(prisma as never),
      prisma,
      tx,
    };
  };

  it('looks up persisted idempotency evidence by scoped actor key', async () => {
    const { repository, prisma } = createRepository();
    const persisted = {
      requestHash: 'hash-1',
      referenceId: 'ref-1',
    };

    prisma.idempotencyKey.findUnique.mockResolvedValue(persisted);

    await expect(
      repository.findIdempotencyRecord(
        IDEMPOTENCY_SCOPE.REFERENCE_CREATE,
        'user-1',
        'idem-1',
      ),
    ).resolves.toEqual(persisted);

    expect(prisma.idempotencyKey.findUnique).toHaveBeenCalledWith({
      where: {
        scope_actorId_idempotencyKey: {
          scope: IDEMPOTENCY_SCOPE.REFERENCE_CREATE,
          actorId: 'user-1',
          idempotencyKey: 'idem-1',
        },
      },
      select: {
        requestHash: true,
        referenceId: true,
      },
    });
  });

  it('performs compare-and-swap cancellation and records one success audit', async () => {
    const { repository, tx } = createRepository();
    type AuditEventCallArg = {
      data: {
        referenceId: string;
        actorType: AuditActorType;
        actorId: string;
        result: string;
        correlationId: string;
      };
    };

    const cancelledReference = {
      id: 'ref-1',
      externalReference: null,
      concept: 'Cancel me',
      amount: BigInt(1000),
      currency: 'COP',
      dueAt: new Date('2026-08-09T13:00:00.000Z'),
      status: ReferenceStatus.CANCELLED,
      version: 5,
      createdBy: 'operator-1',
      createdAt: new Date('2026-08-09T12:00:00.000Z'),
      updatedAt: new Date('2026-08-09T12:30:00.000Z'),
      creator: {
        id: 'operator-1',
        username: 'operator',
        role: 'OPERATOR',
      },
    };

    tx.paymentReference.updateMany.mockResolvedValue({ count: 1 });
    tx.paymentReference.findUnique.mockResolvedValue(cancelledReference);

    await expect(
      repository.cancelPendingReference({
        referenceId: 'ref-1',
        expectedVersion: 4,
        transitionCutoff: new Date('2026-08-09T12:15:00.000Z'),
        actorId: 'supervisor-1',
        correlationId: 'corr-1',
      }),
    ).resolves.toEqual(cancelledReference);

    expect(tx.paymentReference.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'ref-1',
        version: 4,
        status: ReferenceStatus.PENDING,
        dueAt: {
          gt: new Date('2026-08-09T12:15:00.000Z'),
        },
      },
      data: {
        status: ReferenceStatus.CANCELLED,
        version: {
          increment: 1,
        },
      },
    });
    const [auditEventArgs] = tx.auditEvent.create.mock.calls as Array<
      [AuditEventCallArg]
    >;

    expect(auditEventArgs).toBeDefined();

    expect(auditEventArgs?.[0]).toMatchObject({
      data: {
        referenceId: 'ref-1',
        actorType: AuditActorType.USER,
        actorId: 'supervisor-1',
        result: AUDIT_RESULT.SUCCESS,
        correlationId: 'corr-1',
      },
    });
  });

  it('lists overdue pending references in bounded due-date order', async () => {
    const { repository, prisma } = createRepository();
    const now = new Date('2026-08-08T18:00:00.000Z');
    const candidates = [
      {
        id: 'ref-1',
        version: 1,
        dueAt: new Date('2026-08-08T17:00:00.000Z'),
      },
    ];

    prisma.paymentReference.findMany.mockResolvedValue(candidates);

    await expect(
      repository.listOverduePendingReferences(25, now),
    ).resolves.toEqual(candidates);
    expect(prisma.paymentReference.findMany).toHaveBeenCalledWith({
      where: {
        status: ReferenceStatus.PENDING,
        dueAt: {
          lte: now,
        },
      },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      take: 25,
      select: {
        id: true,
        version: true,
        dueAt: true,
      },
    });
  });

  it('expires a still-pending candidate and writes one system audit event', async () => {
    const { repository, tx } = createRepository();
    const now = new Date('2026-08-08T18:00:00.000Z');
    const candidate = {
      id: 'ref-1',
      version: 3,
      dueAt: new Date('2026-08-08T17:00:00.000Z'),
    };

    tx.paymentReference.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      repository.expireReferenceIfStillPending(
        candidate,
        now,
        'system:reference-expirer',
      ),
    ).resolves.toEqual({
      expired: true,
      newVersion: 4,
    });

    expect(tx.auditEvent.create).toHaveBeenCalledWith({
      data: {
        referenceId: candidate.id,
        actorType: AuditActorType.SYSTEM,
        actorId: 'system:reference-expirer',
        action: AUDIT_ACTION.EXPIRE_REFERENCE,
        result: AUDIT_RESULT.SUCCESS,
        metadataJson: {
          previousVersion: 3,
          newVersion: 4,
          dueAt: '2026-08-08T17:00:00.000Z',
        },
      },
    });
  });

  it('skips raced expiration rows without fabricating success audit', async () => {
    const { repository, tx } = createRepository();

    tx.paymentReference.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      repository.expireReferenceIfStillPending(
        {
          id: 'ref-1',
          version: 3,
          dueAt: new Date('2026-08-08T17:00:00.000Z'),
        },
        new Date('2026-08-08T18:00:00.000Z'),
        'system:reference-expirer',
      ),
    ).resolves.toEqual({ expired: false });
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });
});
