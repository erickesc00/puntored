import { AuditActorType, ReferenceStatus } from '@prisma/client';
import {
  ReferenceExpirationRepository,
  type ExpirationCandidate,
} from './reference-expiration.repository';

describe('ReferenceExpirationRepository', () => {
  const createRepository = () => {
    const tx = {
      paymentReference: {
        updateMany: jest.fn(),
      },
      auditEvent: {
        create: jest.fn(),
      },
    };

    const prisma = {
      paymentReference: {
        findMany: jest.fn(),
      },
      $transaction: jest.fn(async (callback: (txArg: typeof tx) => unknown) =>
        callback(tx),
      ),
    };

    return {
      repository: new ReferenceExpirationRepository(prisma as never),
      prisma,
      tx,
    };
  };

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

    await expect(repository.listOverduePending(25, now)).resolves.toEqual(
      candidates,
    );
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
    const candidate: ExpirationCandidate = {
      id: 'ref-1',
      version: 3,
      dueAt: new Date('2026-08-08T17:00:00.000Z'),
    };

    tx.paymentReference.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      repository.expireIfStillPending(
        candidate,
        now,
        'system:reference-expirer',
      ),
    ).resolves.toEqual({
      expired: true,
      newVersion: 4,
    });

    expect(tx.paymentReference.updateMany).toHaveBeenCalledWith({
      where: {
        id: candidate.id,
        version: candidate.version,
        status: ReferenceStatus.PENDING,
        dueAt: {
          lte: now,
        },
      },
      data: {
        status: ReferenceStatus.EXPIRED,
        version: {
          increment: 1,
        },
      },
    });
    expect(tx.auditEvent.create).toHaveBeenCalledWith({
      data: {
        referenceId: candidate.id,
        actorType: AuditActorType.SYSTEM,
        actorId: 'system:reference-expirer',
        action: 'EXPIRE_REFERENCE',
        result: 'SUCCESS',
        metadataJson: {
          previousVersion: 3,
          newVersion: 4,
          dueAt: '2026-08-08T17:00:00.000Z',
        },
      },
    });
  });

  it('skips raced or already-terminal rows without fabricating success audit', async () => {
    const { repository, tx } = createRepository();
    const candidate: ExpirationCandidate = {
      id: 'ref-1',
      version: 3,
      dueAt: new Date('2026-08-08T17:00:00.000Z'),
    };

    tx.paymentReference.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      repository.expireIfStillPending(
        candidate,
        new Date('2026-08-08T18:00:00.000Z'),
        'system:reference-expirer',
      ),
    ).resolves.toEqual({ expired: false });
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });
});
