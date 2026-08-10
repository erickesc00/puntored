import type {
  ReferenceCancelOutcome,
  ReferenceCreateOutcome,
} from '../../domain/references.constants';

export const REFERENCE_METRICS_PORT = Symbol('REFERENCE_METRICS_PORT');

export interface ReferenceMetricsPort {
  recordReferenceCreate(outcome: ReferenceCreateOutcome): void;
  recordReferenceCancel(outcome: ReferenceCancelOutcome): void;
}
