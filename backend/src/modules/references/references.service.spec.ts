import { ReferenceStatus } from '@prisma/client';
import { ApplicationHttpError } from '../../common/errors/application-http.error';
import { AUDIT_RESULT } from '../../shared/vocabulary/audit-results';
import { ERROR_CODE } from '../../shared/vocabulary/error-codes';
import { CancelReferenceUseCase } from './application/use-cases/cancel-reference.use-case';
import { REFERENCE_CANCEL_OUTCOME } from './domain/references.constants';

describe('CancelReferenceUseCase', () => {
  const baseNow = new Date('2026-08-09T12:00:00.000Z');
  const justBeforeExpiry = new Date('2026-08-09T12:00:00.500Z');
  const justAfterExpiry = new Date('2026-08-09T12:00:01.500Z');
  type CancelArgs = {
    referenceId: string;
    expectedVersion: number;
    transitionCutoff: Date;
    actorId: string;
    correlationId?: string;
  };
  type AuditCreateArgs = {
    referenceId?: string;
    result: string;
    metadataJson?: { currentStatus?: ReferenceStatus };
  };

  const createUseCase = () => {
    const repository = {
      findReferenceById: jest.fn(),
      appendAuditEvent: jest.fn().mockResolvedValue(undefined),
      cancelPendingReference: jest.fn(),
      findReferenceStatusSnapshot: jest.fn(),
    };
    const metrics = {
      recordReferenceCancel: jest.fn(),
    };

    return {
      useCase: new CancelReferenceUseCase(
        repository as never,
        metrics as never,
      ),
      repository,
      metrics,
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
    const { useCase, repository, metrics } = createUseCase();
    const reference = {
      id: 'ref-1',
      externalReference: null,
      concept: 'Late cancel race',
      amount: BigInt(1000),
      currency: 'MXN',
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

    repository.findReferenceById.mockResolvedValueOnce(reference);
    repository.cancelPendingReference.mockImplementation(() => {
      jest.setSystemTime(justAfterExpiry);
      return Promise.resolve(null);
    });
    repository.findReferenceStatusSnapshot.mockResolvedValueOnce({
      version: reference.version,
      status: ReferenceStatus.PENDING,
      dueAt: reference.dueAt,
    });

    const pendingResult = useCase.execute(
      reference.id,
      { version: reference.version },
      {
        userId: 'supervisor-1',
        role: 'SUPERVISOR',
      } as never,
    );

    await expect(pendingResult).rejects.toBeInstanceOf(ApplicationHttpError);

    let thrown: unknown;
    await pendingResult.catch((error: unknown) => {
      thrown = error;
    });

    expect(thrown).toBeInstanceOf(ApplicationHttpError);
    expect((thrown as ApplicationHttpError).getResponse()).toMatchObject({
      code: ERROR_CODE.REFERENCE_EXPIRED,
      message: 'Expired references cannot be cancelled',
    });

    const cancelArgs = (
      repository.cancelPendingReference.mock.calls as Array<[CancelArgs]>
    )[0]?.[0];
    const auditArgs = (
      repository.appendAuditEvent.mock.calls as Array<[AuditCreateArgs]>
    ).at(-1)?.[0];

    expect(cancelArgs?.referenceId).toBe(reference.id);
    expect(cancelArgs?.expectedVersion).toBe(reference.version);
    expect(cancelArgs?.transitionCutoff).toBeInstanceOf(Date);
    expect(cancelArgs?.actorId).toBe('supervisor-1');
    expect(cancelArgs?.correlationId).toBeUndefined();
    expect(auditArgs?.referenceId).toBe(reference.id);
    expect(auditArgs?.result).toBe(AUDIT_RESULT.REJECTED_EXPIRED);
    expect(auditArgs?.metadataJson?.currentStatus).toBe(
      ReferenceStatus.EXPIRED,
    );
    expect(metrics.recordReferenceCancel).toHaveBeenNthCalledWith(
      1,
      REFERENCE_CANCEL_OUTCOME.REJECTED_EXPIRED,
    );
  });
});
