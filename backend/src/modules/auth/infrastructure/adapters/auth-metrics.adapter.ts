import { Injectable } from '@nestjs/common';
import type { AuthLoginOutcome } from '../../../../shared/vocabulary/auth-login-outcomes';
import { MetricsService } from '../../../../common/metrics/metrics.service';
import type { AuthMetricsPort } from '../../application/ports/auth-metrics.port';

@Injectable()
export class AuthMetricsAdapter implements AuthMetricsPort {
  constructor(private readonly metricsService: MetricsService) {}

  recordLoginAttempt(outcome: AuthLoginOutcome) {
    this.metricsService.recordLoginAttempt(outcome);
  }
}
