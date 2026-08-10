import { Injectable } from '@nestjs/common';
import { AuditActorType, ReferenceStatus, type Prisma } from '@prisma/client';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { AUDIT_ACTION } from '../../../../shared/vocabulary/audit-actions';
import { AUDIT_RESULT } from '../../../../shared/vocabulary/audit-results';
import { ERROR_CODE } from '../../../../shared/vocabulary/error-codes';
import { PROVIDER_EVENT_OUTCOME } from '../../../../shared/vocabulary/provider-event-outcomes';
import { getEffectiveReferenceStatus } from '../../reference.rules';
import type {
  ProviderReferenceTransitionInput,
  ProviderReferenceTransitionResult,
  ReferencesTransitionPort,
} from '../../application/ports/references-transition.port';

@Injectable()
export class PrismaReferencesTransitionAdapter implements ReferencesTransitionPort {
  constructor(private readonly config: AppConfigService) {}

  async applyProviderEventTransition(
    tx: Prisma.TransactionClient,
    input: ProviderReferenceTransitionInput,
  ): Promise<ProviderReferenceTransitionResult> {
    const reference = await tx.paymentReference.findUnique({
      where: { id: input.referenceId },
    });

    if (!reference) {
      await tx.auditEvent.create({
        data: {
          actorType: AuditActorType.PROVIDER,
          actorId: this.config.provider.actorId,
          action: AUDIT_ACTION.PROVIDER_EVENT,
          result: AUDIT_RESULT.REJECTED_NOT_FOUND,
          correlationId: input.correlationId,
          metadataJson: {
            providerEventId: input.providerEventId,
            referenceId: input.referenceId,
            externalReference: input.externalReference,
            status: input.status,
          },
        },
      });

      return {
        kind: 'rejected',
        outcome: PROVIDER_EVENT_OUTCOME.REJECTED_NOT_FOUND,
        code: ERROR_CODE.REFERENCE_NOT_FOUND,
        message: 'Reference not found',
        status: 404,
      };
    }

    if (
      reference.externalReference &&
      reference.externalReference !== input.externalReference
    ) {
      await tx.auditEvent.create({
        data: {
          referenceId: reference.id,
          actorType: AuditActorType.PROVIDER,
          actorId: this.config.provider.actorId,
          action: AUDIT_ACTION.PROVIDER_EVENT,
          result: AUDIT_RESULT.REJECTED_EXTERNAL_REFERENCE_CONFLICT,
          correlationId: input.correlationId,
          metadataJson: {
            providerEventId: input.providerEventId,
            referenceId: input.referenceId,
            externalReference: input.externalReference,
            status: input.status,
            currentExternalReference: reference.externalReference,
            currentStatus: getEffectiveReferenceStatus(
              reference.status,
              reference.dueAt,
            ),
          },
        },
      });

      return {
        kind: 'rejected',
        outcome: PROVIDER_EVENT_OUTCOME.REJECTED_EXTERNAL_REFERENCE_CONFLICT,
        referenceId: reference.id,
        code: ERROR_CODE.PROVIDER_EXTERNAL_REFERENCE_CONFLICT,
        message: 'Provider external reference conflicts with persisted data',
        status: 409,
      };
    }

    const effectiveStatus = getEffectiveReferenceStatus(
      reference.status,
      reference.dueAt,
    );

    if (effectiveStatus === input.status) {
      return this.persistAlreadyAppliedResult(tx, reference, input);
    }

    if (effectiveStatus !== ReferenceStatus.PENDING) {
      await tx.auditEvent.create({
        data: {
          referenceId: reference.id,
          actorType: AuditActorType.PROVIDER,
          actorId: this.config.provider.actorId,
          action: AUDIT_ACTION.PROVIDER_EVENT,
          result: AUDIT_RESULT.REJECTED_TERMINAL_STATE,
          correlationId: input.correlationId,
          metadataJson: {
            providerEventId: input.providerEventId,
            referenceId: input.referenceId,
            externalReference: input.externalReference,
            status: input.status,
            currentStatus: effectiveStatus,
          },
        },
      });

      return {
        kind: 'rejected',
        outcome: PROVIDER_EVENT_OUTCOME.REJECTED_TERMINAL_STATE,
        referenceId: reference.id,
        code: ERROR_CODE.PROVIDER_EVENT_CONFLICT,
        message: 'Reference already reached a conflicting terminal local state',
        status: 409,
      };
    }

    const transitionCutoff = new Date();
    const updateResult = await tx.paymentReference.updateMany({
      where: {
        id: reference.id,
        version: reference.version,
        status: ReferenceStatus.PENDING,
        dueAt: {
          gt: transitionCutoff,
        },
      },
      data: {
        status: input.status,
        version: {
          increment: 1,
        },
        externalReference:
          reference.externalReference ?? input.externalReference,
      },
    });

    if (updateResult.count === 0) {
      const latestReference = await tx.paymentReference.findUnique({
        where: { id: reference.id },
      });

      if (
        latestReference &&
        getEffectiveReferenceStatus(
          latestReference.status,
          latestReference.dueAt,
        ) === input.status &&
        (!latestReference.externalReference ||
          latestReference.externalReference === input.externalReference)
      ) {
        return this.persistAlreadyAppliedResult(tx, latestReference, input);
      }

      const currentStatus = latestReference
        ? getEffectiveReferenceStatus(
            latestReference.status,
            latestReference.dueAt,
          )
        : reference.status;

      await tx.auditEvent.create({
        data: {
          referenceId: reference.id,
          actorType: AuditActorType.PROVIDER,
          actorId: this.config.provider.actorId,
          action: AUDIT_ACTION.PROVIDER_EVENT,
          result: AUDIT_RESULT.REJECTED_TERMINAL_STATE,
          correlationId: input.correlationId,
          metadataJson: {
            providerEventId: input.providerEventId,
            referenceId: input.referenceId,
            externalReference: input.externalReference,
            status: input.status,
            currentStatus,
          },
        },
      });

      return {
        kind: 'rejected',
        outcome: PROVIDER_EVENT_OUTCOME.REJECTED_TERMINAL_STATE,
        referenceId: reference.id,
        code: ERROR_CODE.PROVIDER_EVENT_CONFLICT,
        message: 'Reference already reached a conflicting terminal local state',
        status: 409,
      };
    }

    const updatedReference = await tx.paymentReference.findUniqueOrThrow({
      where: { id: reference.id },
    });

    await tx.auditEvent.create({
      data: {
        referenceId: updatedReference.id,
        actorType: AuditActorType.PROVIDER,
        actorId: this.config.provider.actorId,
        action: AUDIT_ACTION.PROVIDER_EVENT,
        result: AUDIT_RESULT.SUCCESS,
        correlationId: input.correlationId,
        metadataJson: {
          providerEventId: input.providerEventId,
          externalReference: input.externalReference,
          status: input.status,
          occurredAt: input.occurredAt ?? null,
          paidAt: input.paidAt ?? null,
          newVersion: updatedReference.version,
        },
      },
    });

    return {
      kind: 'accepted',
      outcome: PROVIDER_EVENT_OUTCOME.SUCCESS,
      reference: updatedReference,
      referenceId: updatedReference.id,
    };
  }

  private async persistAlreadyAppliedResult(
    tx: Prisma.TransactionClient,
    reference: {
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
    },
    input: ProviderReferenceTransitionInput,
  ): Promise<ProviderReferenceTransitionResult> {
    const outcome =
      input.status === ReferenceStatus.PAID
        ? PROVIDER_EVENT_OUTCOME.ACCEPTED_ALREADY_PAID
        : PROVIDER_EVENT_OUTCOME.ACCEPTED_ALREADY_CANCELLED;

    await tx.auditEvent.create({
      data: {
        referenceId: reference.id,
        actorType: AuditActorType.PROVIDER,
        actorId: this.config.provider.actorId,
        action: AUDIT_ACTION.PROVIDER_EVENT,
        result: outcome,
        correlationId: input.correlationId,
        metadataJson: {
          providerEventId: input.providerEventId,
          externalReference: input.externalReference,
          currentStatus: input.status,
        },
      },
    });

    return {
      kind: 'already_applied',
      outcome,
      reference,
      referenceId: reference.id,
    };
  }
}
