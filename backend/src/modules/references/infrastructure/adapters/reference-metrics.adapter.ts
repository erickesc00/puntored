import { Injectable } from '@nestjs/common';
import { MetricsService } from '../../../../common/metrics/metrics.service';
import { type ReferenceMetricsPort } from '../../application/ports/metrics.port';
import type {
  ReferenceCancelOutcome,
  ReferenceCreateOutcome,
} from '../../domain/references.constants';

@Injectable()
export class ReferenceMetricsAdapter implements ReferenceMetricsPort {
  constructor(private readonly metricsService: MetricsService) {}

  recordReferenceCreate(outcome: ReferenceCreateOutcome) {
    this.metricsService.recordReferenceCreate(outcome);
  }

  recordReferenceCancel(outcome: ReferenceCancelOutcome) {
    this.metricsService.recordReferenceCancel(outcome);
  }
}
