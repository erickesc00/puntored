import { ConflictException } from '@nestjs/common';
import { ReferenceStatus } from '@prisma/client';
import { AUDIT_RESULT } from '../../shared/vocabulary/audit-results';
import { ERROR_CODE } from '../../shared/vocabulary/error-codes';
import { PROVIDER_EVENT_OUTCOME } from '../../shared/vocabulary/provider-event-outcomes';
import type {
  ProviderReferenceTransitionInput,
  ProviderReferenceTransitionResult,
} from '../references/application/ports/references-transition.port';
import { PrismaProviderEventProcessor } from './infrastructure/persistence/prisma-provider-event.processor';

describe('PrismaProviderEventProcessor', () => {
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

  type ReferenceRecordDouble = {
    id: string;
    externalReference: string | null;
    concept: string;
    amount: bigint;
    currency: string;
    dueAt: Date;
    status: ReferenceStatus;
    version: number;
    createdBy: string;
    createdAt: Date;
    updatedAt: Date;
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

  type TxDouble = {
    providerEvent: {
      create: jest.Mock<Promise<{ id: string }>, [unknown]>;
      update: jest.Mock<Promise<void>, [ProviderEventUpdateArgs]>;
    };
    paymentReference: {
      findUnique: jest.Mock<
        Promise<ReferenceRecordDouble | null>,
        [{ where: { id: string } }]
      >;
      updateMany: jest.Mock<Promise<{ count: number }>, [UpdateManyArgs]>;
      findUniqueOrThrow: jest.Mock<Promise<ReferenceRecordDouble>, [unknown]>;
    };
    auditEvent: {
      create: jest.Mock<Promise<void>, [AuditCreateArgs]>;
    };
  };

  const createProcessor = () => {
    const tx: TxDouble = {
      providerEvent: {
        create: jest
          .fn<Promise<{ id: string }>, [unknown]>()
          .mockResolvedValue({ id: 'provider-row-1' }),
        update: jest
          .fn<Promise<void>, [ProviderEventUpdateArgs]>()
          .mockResolvedValue(undefined),
      },
      paymentReference: {
        findUnique: jest.fn<
          Promise<ReferenceRecordDouble | null>,
          [{ where: { id: string } }]
        >(),
        updateMany: jest.fn<Promise<{ count: number }>, [UpdateManyArgs]>(),
        findUniqueOrThrow: jest.fn<Promise<ReferenceRecordDouble>, [unknown]>(),
      },
      auditEvent: {
        create: jest
          .fn<Promise<void>, [AuditCreateArgs]>()
          .mockResolvedValue(undefined),
      },
    };

    const prisma = {
      $transaction: jest.fn((callback: (client: TxDouble) => unknown) =>
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
    const referencesTransitionPort = {
      applyProviderEventTransition: jest.fn<
        Promise<ProviderReferenceTransitionResult>,
        [TxDouble, ProviderReferenceTransitionInput]
      >(async (innerTx, input) => {
        const reference = await innerTx.paymentReference.findUnique({
          where: { id: input.referenceId },
        });

        if (!reference) {
          throw new Error('Expected reference to exist in test double');
        }

        const updateResult = await innerTx.paymentReference.updateMany({
          where: {
            id: reference.id,
            version: reference.version,
            status: ReferenceStatus.PENDING,
            dueAt: {
              gt: new Date(),
            },
          },
          data: {
            status: input.status,
            version: {
              increment: 1,
            },
            externalReference: input.externalReference,
          },
        });

        if (updateResult.count === 0) {
          const latestReference = await innerTx.paymentReference.findUnique({
            where: { id: reference.id },
          });

          if (!latestReference) {
            throw new Error(
              'Expected latest reference to exist in test double',
            );
          }

          await innerTx.auditEvent.create({
            data: {
              referenceId: reference.id,
              result: AUDIT_RESULT.REJECTED_TERMINAL_STATE,
              metadataJson: {
                currentStatus:
                  latestReference.dueAt <= new Date()
                    ? ReferenceStatus.EXPIRED
                    : latestReference.status,
              },
            },
          });

          return {
            kind: 'rejected',
            outcome: PROVIDER_EVENT_OUTCOME.REJECTED_TERMINAL_STATE,
            referenceId: reference.id,
            code: ERROR_CODE.PROVIDER_EVENT_CONFLICT,
            message:
              'Reference already reached a conflicting terminal local state',
            status: 409,
          } as const;
        }

        throw new Error('Unexpected success path in test double');
      }),
    };

    return {
      processor: new PrismaProviderEventProcessor(
        prisma as never,
        config as never,
        metricsService as never,
        referencesTransitionPort as never,
      ),
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

  it('rejects provider-paid writes that lose to expiry inside the transactional update guard', async () => {
    const { processor, tx, metricsService } = createProcessor();
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

    const pendingResult = processor.processProviderEvent({
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

    expect((thrown as ConflictException).getResponse()).toMatchObject({
      code: ERROR_CODE.PROVIDER_EVENT_CONFLICT,
      message: 'Reference already reached a conflicting terminal local state',
    });

    const updateArgs = tx.paymentReference.updateMany.mock.calls[0]?.[0];
    const providerEventUpdateArgs =
      tx.providerEvent.update.mock.calls.at(-1)?.[0];
    const auditArgs = tx.auditEvent.create.mock.calls.at(-1)?.[0];

    expect(auditArgs).toBeDefined();

    if (!auditArgs) {
      throw new Error('Expected audit event arguments to be captured');
    }

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
        outcome: PROVIDER_EVENT_OUTCOME.REJECTED_TERMINAL_STATE,
      },
    });
    expect(auditArgs.data.referenceId).toBe(reference.id);
    expect(auditArgs.data.result).toBe(AUDIT_RESULT.REJECTED_TERMINAL_STATE);
    expect(auditArgs.data.metadataJson.currentStatus).toBe(
      ReferenceStatus.EXPIRED,
    );
    expect(metricsService.recordProviderEvent).toHaveBeenCalledWith(
      'PAID',
      PROVIDER_EVENT_OUTCOME.REJECTED_TERMINAL_STATE,
    );
  });
});
