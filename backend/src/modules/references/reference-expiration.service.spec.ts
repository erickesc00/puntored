import { SchedulerRegistry } from '@nestjs/schedule';
import {
  REFERENCE_EXPIRATION_CRON_JOB,
  ReferenceExpirationService,
} from './reference-expiration.service';

describe('ReferenceExpirationService', () => {
  const createService = (overrides?: {
    enabled?: boolean;
    cron?: string;
    batchSize?: number;
    actorId?: string;
    candidates?: Array<{ id: string; version: number; dueAt: Date }>;
    expireResults?: Array<{ expired: boolean; newVersion?: number }>;
  }) => {
    const schedulerRegistry = new SchedulerRegistry();
    const repository = {
      listOverduePendingReferences: jest
        .fn()
        .mockResolvedValue(overrides?.candidates ?? []),
      expireReferenceIfStillPending: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            overrides?.expireResults?.shift() ?? { expired: false },
          ),
        ),
    };
    const metricsService = {
      recordReferenceExpirationAttempted: jest.fn(),
      recordReferenceExpirationExpired: jest.fn(),
      recordReferenceExpirationSkipped: jest.fn(),
    };
    const service = new ReferenceExpirationService(
      {
        referenceExpiration: {
          enabled: overrides?.enabled ?? false,
          cron: overrides?.cron ?? '* * * * *',
          batchSize: overrides?.batchSize ?? 100,
          actorId: overrides?.actorId ?? 'system:test-reference-expirer',
        },
      } as never,
      schedulerRegistry,
      repository as never,
      metricsService as never,
    );

    return { service, schedulerRegistry, repository, metricsService };
  };

  it('does not register a cron job when expiration is disabled', () => {
    const { service, schedulerRegistry } = createService();

    service.onApplicationBootstrap();

    expect(() =>
      schedulerRegistry.getCronJob(REFERENCE_EXPIRATION_CRON_JOB),
    ).toThrow();
  });

  it('registers a cron job when expiration is enabled', async () => {
    const { service, schedulerRegistry } = createService({
      enabled: true,
      cron: '*/5 * * * *',
    });

    service.onApplicationBootstrap();

    const job = schedulerRegistry.getCronJob(REFERENCE_EXPIRATION_CRON_JOB);

    expect(job).toBeDefined();
    expect(job.isActive).toBe(true);

    await service.onModuleDestroy();
  });

  it('supports deterministic manual ticks', async () => {
    const { service, repository, metricsService } = createService({
      batchSize: 25,
      actorId: 'system:reference-expirer',
      candidates: [
        {
          id: 'ref-1',
          version: 1,
          dueAt: new Date('2026-08-08T17:55:00.000Z'),
        },
        {
          id: 'ref-2',
          version: 7,
          dueAt: new Date('2026-08-08T17:56:00.000Z'),
        },
      ],
      expireResults: [{ expired: true, newVersion: 2 }, { expired: false }],
    });

    const now = new Date('2026-08-08T18:00:00.000Z');

    await expect(service.runTick(now)).resolves.toEqual({
      attempted: 2,
      expired: 1,
      skipped: 1,
      batchSize: 25,
      actorId: 'system:reference-expirer',
      evaluatedAt: '2026-08-08T18:00:00.000Z',
    });

    expect(repository.listOverduePendingReferences).toHaveBeenCalledWith(
      25,
      now,
    );
    expect(repository.expireReferenceIfStillPending).toHaveBeenNthCalledWith(
      1,
      {
        id: 'ref-1',
        version: 1,
        dueAt: new Date('2026-08-08T17:55:00.000Z'),
      },
      now,
      'system:reference-expirer',
    );
    expect(repository.expireReferenceIfStillPending).toHaveBeenNthCalledWith(
      2,
      {
        id: 'ref-2',
        version: 7,
        dueAt: new Date('2026-08-08T17:56:00.000Z'),
      },
      now,
      'system:reference-expirer',
    );
    expect(
      metricsService.recordReferenceExpirationAttempted,
    ).toHaveBeenCalledWith(2);
    expect(
      metricsService.recordReferenceExpirationExpired,
    ).toHaveBeenCalledWith(1);
    expect(
      metricsService.recordReferenceExpirationSkipped,
    ).toHaveBeenCalledWith(1);
  });
});
