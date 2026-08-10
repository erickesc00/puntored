import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AuditActorType, ReferenceStatus } from '@prisma/client';
import { ApplicationHttpError } from '../../../../common/errors/application-http.error';
import { AUDIT_RESULT } from '../../../../shared/vocabulary/audit-results';
import { ERROR_CODE } from '../../../../shared/vocabulary/error-codes';
import type { SessionAuth } from '../../../auth/guards/session.guard';
import { CancelReferenceDto } from '../../dto/cancel-reference.dto';
import {
  REFERENCE_METRICS_PORT,
  type ReferenceMetricsPort,
} from '../ports/metrics.port';
import {
  REFERENCE_REPOSITORY,
  type ReferenceRepository,
} from '../ports/reference.repository';
import { serializeReference } from '../../reference-response.mapper';
import { evaluateCancellationEligibility } from '../../domain/policies/reference-cancellation.policy';
import { getEffectiveReferenceStatus } from '../../reference.rules';
import {
  REFERENCE_AUDIT_ACTION,
  REFERENCE_CANCEL_OUTCOME,
} from '../../domain/references.constants';

@Injectable()
export class CancelReferenceUseCase {
  constructor(
    @Inject(REFERENCE_REPOSITORY)
    private readonly repository: ReferenceRepository,
    @Inject(REFERENCE_METRICS_PORT)
    private readonly metrics: ReferenceMetricsPort,
  ) {}

  async execute(
    id: string,
    payload: CancelReferenceDto,
    actor: SessionAuth,
    correlationId?: string,
  ) {
    const reference = await this.repository.findReferenceById(id);

    if (!reference) {
      this.metrics.recordReferenceCancel(
        REFERENCE_CANCEL_OUTCOME.REJECTED_NOT_FOUND,
      );
      await this.repository.appendAuditEvent({
        actorType: AuditActorType.USER,
        actorId: actor.userId,
        action: REFERENCE_AUDIT_ACTION.CANCEL_ATTEMPT,
        result: AUDIT_RESULT.REJECTED_NOT_FOUND,
        correlationId,
        metadataJson: {
          referenceId: id,
          expectedVersion: payload.version,
        },
      });

      throw new ApplicationHttpError(
        HttpStatus.NOT_FOUND,
        ERROR_CODE.REFERENCE_NOT_FOUND,
        'Reference not found',
      );
    }

    await this.repository.appendAuditEvent({
      referenceId: reference.id,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: REFERENCE_AUDIT_ACTION.CANCEL_ATTEMPT,
      result: AUDIT_RESULT.STARTED,
      correlationId,
      metadataJson: {
        expectedVersion: payload.version,
        currentVersion: reference.version,
      },
    });

    const eligibility = evaluateCancellationEligibility({
      currentStatus: reference.status,
      dueAt: reference.dueAt,
      currentVersion: reference.version,
      expectedVersion: payload.version,
    });

    if (!eligibility.allowed) {
      const result =
        eligibility.reason === 'VERSION_MISMATCH'
          ? AUDIT_RESULT.REJECTED_VERSION_CONFLICT
          : eligibility.reason === 'REFERENCE_EXPIRED'
            ? AUDIT_RESULT.REJECTED_EXPIRED
            : AUDIT_RESULT.REJECTED_INVALID_STATUS;

      await this.repository.appendAuditEvent({
        referenceId: reference.id,
        actorType: AuditActorType.USER,
        actorId: actor.userId,
        action: REFERENCE_AUDIT_ACTION.CANCEL,
        result,
        correlationId,
        metadataJson: {
          expectedVersion: payload.version,
          currentVersion: reference.version,
          currentStatus: eligibility.effectiveStatus,
        },
      });

      if (eligibility.reason === 'VERSION_MISMATCH') {
        this.metrics.recordReferenceCancel(
          REFERENCE_CANCEL_OUTCOME.REJECTED_VERSION_CONFLICT,
        );
        throw new ApplicationHttpError(
          HttpStatus.CONFLICT,
          ERROR_CODE.REFERENCE_VERSION_CONFLICT,
          'Reference version conflict',
        );
      }

      this.metrics.recordReferenceCancel(
        eligibility.reason === 'REFERENCE_EXPIRED'
          ? REFERENCE_CANCEL_OUTCOME.REJECTED_EXPIRED
          : REFERENCE_CANCEL_OUTCOME.REJECTED_INVALID_STATE,
      );
      throw new ApplicationHttpError(
        HttpStatus.CONFLICT,
        eligibility.reason === 'REFERENCE_EXPIRED'
          ? ERROR_CODE.REFERENCE_EXPIRED
          : ERROR_CODE.INVALID_REFERENCE_STATE,
        eligibility.reason === 'REFERENCE_EXPIRED'
          ? 'Expired references cannot be cancelled'
          : 'Reference cannot be cancelled from the current state',
      );
    }

    const cancellationResult = await this.repository.cancelPendingReference({
      referenceId: reference.id,
      expectedVersion: reference.version,
      transitionCutoff: new Date(),
      actorId: actor.userId,
      correlationId,
    });

    if (!cancellationResult) {
      const persistedReference =
        await this.repository.findReferenceStatusSnapshot(reference.id);

      const currentStatus = persistedReference
        ? getEffectiveReferenceStatus(
            persistedReference.status,
            persistedReference.dueAt,
          )
        : reference.status;
      const expiredDuringTransition = currentStatus === ReferenceStatus.EXPIRED;

      await this.repository.appendAuditEvent({
        referenceId: reference.id,
        actorType: AuditActorType.USER,
        actorId: actor.userId,
        action: REFERENCE_AUDIT_ACTION.CANCEL,
        result: expiredDuringTransition
          ? AUDIT_RESULT.REJECTED_EXPIRED
          : AUDIT_RESULT.REJECTED_VERSION_CONFLICT,
        correlationId,
        metadataJson: {
          expectedVersion: payload.version,
          currentVersion: persistedReference?.version ?? reference.version,
          currentStatus,
        },
      });

      this.metrics.recordReferenceCancel(
        expiredDuringTransition
          ? REFERENCE_CANCEL_OUTCOME.REJECTED_EXPIRED
          : REFERENCE_CANCEL_OUTCOME.REJECTED_VERSION_CONFLICT,
      );

      if (expiredDuringTransition) {
        throw new ApplicationHttpError(
          HttpStatus.CONFLICT,
          ERROR_CODE.REFERENCE_EXPIRED,
          'Expired references cannot be cancelled',
        );
      }

      throw new ApplicationHttpError(
        HttpStatus.CONFLICT,
        ERROR_CODE.REFERENCE_VERSION_CONFLICT,
        'Reference version conflict',
      );
    }

    this.metrics.recordReferenceCancel(REFERENCE_CANCEL_OUTCOME.SUCCESS);
    return serializeReference(cancellationResult);
  }
}
