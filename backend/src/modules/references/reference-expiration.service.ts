import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { AppConfigService } from '../../common/config/app-config.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { ReferenceExpirationRepository } from './reference-expiration.repository';

export const REFERENCE_EXPIRATION_CRON_JOB = 'reference-expiration';

export interface ReferenceExpirationTickResult {
  attempted: number;
  expired: number;
  skipped: number;
  batchSize: number;
  actorId: string;
  evaluatedAt: string;
}

@Injectable()
export class ReferenceExpirationService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ReferenceExpirationService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly repository: ReferenceExpirationRepository,
    private readonly metricsService: MetricsService,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.referenceExpiration.enabled) {
      this.logger.debug('Reference expiration scheduler is disabled.');
      return;
    }

    const job = CronJob.from({
      cronTime: this.config.referenceExpiration.cron,
      onTick: () => {
        void this.handleCron();
      },
      start: false,
    });

    this.schedulerRegistry.addCronJob(REFERENCE_EXPIRATION_CRON_JOB, job);
    job.start();
  }

  async onModuleDestroy() {
    try {
      const job = this.schedulerRegistry.getCronJob(
        REFERENCE_EXPIRATION_CRON_JOB,
      );
      await job.stop();
      this.schedulerRegistry.deleteCronJob(REFERENCE_EXPIRATION_CRON_JOB);
    } catch {
      // No registered cron job to dispose.
    }
  }

  async handleCron() {
    try {
      await this.runTick();
    } catch (error) {
      this.logger.error(
        'Reference expiration tick failed.',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  async runTick(now = new Date()): Promise<ReferenceExpirationTickResult> {
    const batchSize = this.config.referenceExpiration.batchSize;
    const actorId = this.config.referenceExpiration.actorId;
    const candidates = await this.repository.listOverduePending(batchSize, now);

    let expired = 0;
    let skipped = 0;

    this.metricsService.recordReferenceExpirationAttempted(candidates.length);

    for (const candidate of candidates) {
      const result = await this.repository.expireIfStillPending(
        candidate,
        now,
        actorId,
      );

      if (result.expired) {
        expired += 1;
      } else {
        skipped += 1;
      }
    }

    if (expired > 0) {
      this.metricsService.recordReferenceExpirationExpired(expired);
    }

    if (skipped > 0) {
      this.metricsService.recordReferenceExpirationSkipped(skipped);
    }

    const tickResult = {
      attempted: candidates.length,
      expired,
      skipped,
      batchSize,
      actorId,
      evaluatedAt: now.toISOString(),
    };

    this.logger.debug(
      `Reference expiration tick completed: attempted=${tickResult.attempted} expired=${tickResult.expired} skipped=${tickResult.skipped}`,
    );

    return tickResult;
  }
}
