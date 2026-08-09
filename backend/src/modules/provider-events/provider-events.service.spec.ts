import { ConflictException } from '@nestjs/common';
import { ReferenceStatus } from '@prisma/client';
import { ProviderEventsService } from './provider-events.service';

describe('ProviderEventsService', () => {
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
      externalReference: string;
    };
  };
  type ProviderEventUpdateArgs = {
    where: { id: string };
    data: { referenceId: string; outcome: string };
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
      providerEvent: {
        create: jest.fn().mockResolvedValue({ id: 'provider-row-1' }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      paymentReference: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      auditEvent: {
        create: jest.fn().mockResolvedValue(undefined),
      },
    };

    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
      providerEvent: {
        findUnique: jest.fn(),
      },
      auditEvent: {
        create: jest.fn(),
      },
      paymentReference: {
        findUnique: jest.fn(),
      },
    };
    const config = {
      provider: {
        actorId: 'provider:test',
      },
    };
    const metricsService = {
      recordProviderEvent: jest.fn(),
    };

    return {
      service: new ProviderEventsService(
        prisma as never,
        config as never,
        metricsService as never,
      ),
      tx,
      prisma,
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

  it('rejects provider-paid writes that lose to expiry inside the transactional update guard', async () => {
    const { service, tx, metricsService } = createService();
    const reference = {
      id: 'ref-1',
      externalReference: null,
      concept: 'Late provider race',
      amount: BigInt(1000),
      currency: 'COP',
      dueAt: new Date('2026-08-09T12:00:01.000Z'),
      status: ReferenceStatus.PENDING,
      version: 4,
      createdBy: 'user-1',
      createdAt: justBeforeExpiry,
      updatedAt: justBeforeExpiry,
    };

    tx.paymentReference.findUnique
      .mockResolvedValueOnce(reference)
      .mockResolvedValueOnce(reference);
    tx.paymentReference.updateMany.mockImplementation(() => {
      jest.setSystemTime(justAfterExpiry);
      return Promise.resolve({ count: 0 });
    });

    const pendingResult = service.processProviderEvent({
      providerEventId: 'provider-event-1',
      referenceId: reference.id,
      externalReference: 'EXT-LATE-001',
      status: 'PAID',
      paidAt: justAfterExpiry.toISOString(),
    });

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
      code: 'PROVIDER_EVENT_CONFLICT',
      message: 'Reference already reached a conflicting terminal local state',
    });

    const updateArgs = (
      tx.paymentReference.updateMany.mock.calls as Array<[UpdateManyArgs]>
    )[0]?.[0];
    const providerEventUpdateArgs = (
      tx.providerEvent.update.mock.calls as Array<[ProviderEventUpdateArgs]>
    ).at(-1)?.[0];
    const auditArgs = (
      tx.auditEvent.create.mock.calls as Array<[AuditCreateArgs]>
    ).at(-1)?.[0];

    expect(updateArgs).toBeDefined();
    expect(providerEventUpdateArgs).toBeDefined();
    expect(auditArgs).toBeDefined();

    expect(updateArgs?.where.id).toBe(reference.id);
    expect(updateArgs?.where.version).toBe(reference.version);
    expect(updateArgs?.where.status).toBe(ReferenceStatus.PENDING);
    expect(updateArgs?.where.dueAt.gt).toBeInstanceOf(Date);
    expect(updateArgs?.data).toEqual({
      status: ReferenceStatus.PAID,
      version: {
        increment: 1,
      },
      externalReference: 'EXT-LATE-001',
    });
    expect(providerEventUpdateArgs).toEqual({
      where: { id: 'provider-row-1' },
      data: {
        referenceId: reference.id,
        outcome: 'REJECTED_TERMINAL_STATE',
      },
    });
    expect(auditArgs?.data.referenceId).toBe(reference.id);
    expect(auditArgs?.data.result).toBe('REJECTED_TERMINAL_STATE');
    expect(auditArgs?.data.metadataJson.currentStatus).toBe(
      ReferenceStatus.EXPIRED,
    );
    expect(metricsService.recordProviderEvent).toHaveBeenCalledWith(
      'PAID',
      'REJECTED_TERMINAL_STATE',
    );
  });
});
