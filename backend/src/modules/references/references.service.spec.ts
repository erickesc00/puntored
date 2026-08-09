import { ConflictException } from '@nestjs/common';
import { ReferenceStatus } from '@prisma/client';
import { ReferencesService } from './references.service';

describe('ReferencesService', () => {
  const baseNow = new Date('2026-08-09T12:00:00.000Z');
  const justBeforeExpiry = new Date('2026-08-09T12:00:00.500Z');
  const justAfterExpiry = new Date('2026-08-09T12:00:01.500Z');
  type UpdateManyArgs = {
    where: {
      id: string;
      version: number;
      status: ReferenceStatus;
      dueAt: { gt: Date };
    };
    data: {
      status: ReferenceStatus;
      version: { increment: number };
    };
  };
  type AuditCreateArgs = {
    data: {
      referenceId: string;
      result: string;
      metadataJson: { currentStatus: ReferenceStatus };
    };
  };

  const createService = () => {
    const tx = {
      paymentReference: {
        updateMany: jest.fn(),
        findUnique: jest.fn(),
      },
      auditEvent: {
        create: jest.fn().mockResolvedValue(undefined),
      },
    };
    const prisma = {
      paymentReference: {
        findUnique: jest.fn(),
      },
      auditEvent: {
        create: jest.fn().mockResolvedValue(undefined),
      },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
      idempotencyKey: {
        findUnique: jest.fn(),
      },
    };
    const metricsService = {
      recordReferenceCancel: jest.fn(),
      recordReferenceCreate: jest.fn(),
    };
    const providerAllocationClient = {
      isEnabled: false,
    };

    return {
      service: new ReferencesService(
        prisma as never,
        metricsService as never,
        providerAllocationClient as never,
      ),
      prisma,
      tx,
      metricsService,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(baseNow);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('rejects cancellation when the row expires before the transactional update can claim it', async () => {
    const { service, prisma, tx, metricsService } = createService();
    const reference = {
      id: 'ref-1',
      externalReference: null,
      concept: 'Late cancel race',
      amount: BigInt(1000),
      currency: 'COP',
      dueAt: new Date('2026-08-09T12:00:01.000Z'),
      status: ReferenceStatus.PENDING,
      version: 7,
      createdBy: 'user-1',
      createdAt: justBeforeExpiry,
      updatedAt: justBeforeExpiry,
      creator: {
        id: 'user-1',
        username: 'operator',
        role: 'OPERATOR',
      },
    };

    prisma.paymentReference.findUnique
      .mockResolvedValueOnce(reference)
      .mockResolvedValueOnce({
        version: reference.version,
        status: ReferenceStatus.PENDING,
        dueAt: reference.dueAt,
      });
    tx.paymentReference.updateMany.mockImplementation(() => {
      jest.setSystemTime(justAfterExpiry);
      return Promise.resolve({ count: 0 });
    });

    const pendingResult = service.cancelReference(
      reference.id,
      { version: reference.version },
      {
        userId: 'supervisor-1',
        role: 'SUPERVISOR',
      } as never,
    );

    await expect(pendingResult).rejects.toBeInstanceOf(ConflictException);

    let thrown: unknown;
    await pendingResult.catch((error: unknown) => {
      thrown = error;
    });

    expect(thrown).toBeInstanceOf(ConflictException);
    expect(
      (thrown as ConflictException).getResponse() as {
        code: string;
        message: string;
      },
    ).toMatchObject({
      code: 'REFERENCE_EXPIRED',
      message: 'Expired references cannot be cancelled',
    });

    const updateArgs = (
      tx.paymentReference.updateMany.mock.calls as Array<[UpdateManyArgs]>
    )[0]?.[0];
    const auditArgs = (
      prisma.auditEvent.create.mock.calls as Array<[AuditCreateArgs]>
    )[1]?.[0];

    expect(updateArgs).toBeDefined();
    expect(auditArgs).toBeDefined();

    expect(updateArgs?.where.id).toBe(reference.id);
    expect(updateArgs?.where.version).toBe(reference.version);
    expect(updateArgs?.where.status).toBe(ReferenceStatus.PENDING);
    expect(updateArgs?.where.dueAt.gt).toBeInstanceOf(Date);
    expect(updateArgs?.data).toEqual({
      status: ReferenceStatus.CANCELLED,
      version: {
        increment: 1,
      },
    });
    expect(auditArgs?.data.referenceId).toBe(reference.id);
    expect(auditArgs?.data.result).toBe('REJECTED_EXPIRED');
    expect(auditArgs?.data.metadataJson.currentStatus).toBe(
      ReferenceStatus.EXPIRED,
    );
    expect(metricsService.recordReferenceCancel).toHaveBeenNthCalledWith(
      1,
      'rejected_expired',
    );
  });
});
