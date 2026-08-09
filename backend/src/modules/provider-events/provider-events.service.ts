import { createHash } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ReferenceStatus,
  type PaymentReference,
  type ProviderEvent,
} from '@prisma/client';
import { AppConfigService } from '../../common/config/app-config.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getEffectiveReferenceStatus } from '../references/reference.rules';
import { ProviderCallbackDto } from './dto/provider-callback.dto';

type ProviderResult =
  | {
      kind: 'accepted' | 'already_applied' | 'duplicate';
      outcome: string;
      reference: PaymentReference;
      providerEventId: string;
    }
  | {
      kind: 'rejected';
      outcome: string;
      providerEventId: string;
      code: string;
      message: string;
      status: 404 | 409;
    };

@Injectable()
export class ProviderEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly metricsService: MetricsService,
  ) {}

  async processProviderEvent(
    payload: ProviderCallbackDto,
    correlationId?: string,
  ) {
    const payloadHash = this.createPayloadHash(payload);

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const providerEvent = await tx.providerEvent.create({
          data: {
            providerEventId: payload.providerEventId,
            externalReference: payload.externalReference,
            payloadHash,
            eventType: payload.status,
            outcome: 'RECEIVED',
          },
        });

        return this.applyProviderEvent(
          tx,
          providerEvent,
          payload,
          correlationId,
        );
      });

      this.metricsService.recordProviderEvent(payload.status, result.outcome);
      return this.finalizeResult(result);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const duplicateResult = await this.resolveDuplicateEvent(
          payload,
          payloadHash,
          correlationId,
        );
        this.metricsService.recordProviderEvent(
          payload.status,
          duplicateResult.outcome,
        );
        return this.finalizeResult(duplicateResult);
      }

      throw error;
    }
  }

  private async applyProviderEvent(
    tx: Prisma.TransactionClient,
    providerEvent: ProviderEvent,
    payload: ProviderCallbackDto,
    correlationId?: string,
  ): Promise<ProviderResult> {
    const reference = await tx.paymentReference.findUnique({
      where: { id: payload.referenceId },
    });

    if (!reference) {
      return this.rejectEvent(tx, providerEvent.id, payload, correlationId, {
        outcome: 'REJECTED_NOT_FOUND',
        code: 'REFERENCE_NOT_FOUND',
        message: 'Reference not found',
        status: 404,
      });
    }

    if (
      reference.externalReference &&
      reference.externalReference !== payload.externalReference
    ) {
      return this.rejectEvent(tx, providerEvent.id, payload, correlationId, {
        outcome: 'REJECTED_EXTERNAL_REFERENCE_CONFLICT',
        code: 'PROVIDER_EXTERNAL_REFERENCE_CONFLICT',
        message: 'Provider external reference conflicts with persisted data',
        status: 409,
        reference,
        metadataJson: {
          currentExternalReference: reference.externalReference,
          currentStatus: getEffectiveReferenceStatus(
            reference.status,
            reference.dueAt,
          ),
        },
      });
    }

    const effectiveStatus = getEffectiveReferenceStatus(
      reference.status,
      reference.dueAt,
    );

    if (this.isAlreadyApplied(effectiveStatus, payload.status)) {
      return this.persistAlreadyAppliedResult(
        tx,
        providerEvent.id,
        reference,
        payload,
        correlationId,
      );
    }

    if (effectiveStatus !== ReferenceStatus.PENDING) {
      return this.rejectEvent(tx, providerEvent.id, payload, correlationId, {
        outcome: 'REJECTED_TERMINAL_STATE',
        code: 'PROVIDER_EVENT_CONFLICT',
        message: 'Reference already reached a conflicting terminal local state',
        status: 409,
        reference,
        metadataJson: {
          currentStatus: effectiveStatus,
        },
      });
    }

    const updateResult = await tx.paymentReference.updateMany({
      where: {
        id: reference.id,
        version: reference.version,
        status: ReferenceStatus.PENDING,
      },
      data: {
        status: payload.status,
        version: {
          increment: 1,
        },
        externalReference:
          reference.externalReference ?? payload.externalReference,
      },
    });

    if (updateResult.count === 0) {
      const latestReference = await tx.paymentReference.findUnique({
        where: { id: reference.id },
      });

      if (
        latestReference &&
        this.isAlreadyApplied(
          getEffectiveReferenceStatus(
            latestReference.status,
            latestReference.dueAt,
          ),
          payload.status,
        ) &&
        (!latestReference.externalReference ||
          latestReference.externalReference === payload.externalReference)
      ) {
        return this.persistAlreadyAppliedResult(
          tx,
          providerEvent.id,
          latestReference,
          payload,
          correlationId,
        );
      }

      const currentStatus = latestReference
        ? getEffectiveReferenceStatus(
            latestReference.status,
            latestReference.dueAt,
          )
        : reference.status;

      return this.rejectEvent(tx, providerEvent.id, payload, correlationId, {
        outcome: 'REJECTED_TERMINAL_STATE',
        code: 'PROVIDER_EVENT_CONFLICT',
        message: 'Reference already reached a conflicting terminal local state',
        status: 409,
        reference,
        metadataJson: {
          currentStatus,
        },
      });
    }

    const updatedReference = await tx.paymentReference.findUniqueOrThrow({
      where: { id: reference.id },
    });

    await tx.providerEvent.update({
      where: { id: providerEvent.id },
      data: {
        referenceId: updatedReference.id,
        outcome: 'SUCCESS',
      },
    });
    await tx.auditEvent.create({
      data: {
        referenceId: updatedReference.id,
        actorType: 'PROVIDER',
        actorId: this.config.provider.actorId,
        action: 'PROVIDER_EVENT',
        result: 'SUCCESS',
        correlationId,
        metadataJson: {
          providerEventId: payload.providerEventId,
          externalReference: payload.externalReference,
          status: payload.status,
          occurredAt: payload.occurredAt ?? null,
          paidAt: payload.paidAt ?? null,
          newVersion: updatedReference.version,
        },
      },
    });

    return {
      kind: 'accepted',
      outcome: 'SUCCESS',
      providerEventId: payload.providerEventId,
      reference: updatedReference,
    };
  }

  private async persistAlreadyAppliedResult(
    tx: Prisma.TransactionClient,
    providerEventRowId: string,
    reference: PaymentReference,
    payload: ProviderCallbackDto,
    correlationId?: string,
  ): Promise<ProviderResult> {
    const outcome =
      payload.status === 'PAID'
        ? 'ACCEPTED_ALREADY_PAID'
        : 'ACCEPTED_ALREADY_CANCELLED';

    await tx.providerEvent.update({
      where: { id: providerEventRowId },
      data: {
        referenceId: reference.id,
        outcome,
      },
    });
    await tx.auditEvent.create({
      data: {
        referenceId: reference.id,
        actorType: 'PROVIDER',
        actorId: this.config.provider.actorId,
        action: 'PROVIDER_EVENT',
        result: outcome,
        correlationId,
        metadataJson: {
          providerEventId: payload.providerEventId,
          externalReference: payload.externalReference,
          currentStatus: payload.status,
        },
      },
    });

    return {
      kind: 'already_applied',
      outcome,
      providerEventId: payload.providerEventId,
      reference,
    };
  }

  private async rejectEvent(
    tx: Prisma.TransactionClient,
    providerEventRowId: string,
    payload: ProviderCallbackDto,
    correlationId: string | undefined,
    input: {
      outcome: string;
      code: string;
      message: string;
      status: 404 | 409;
      reference?: PaymentReference;
      metadataJson?: Record<string, unknown>;
    },
  ): Promise<ProviderResult> {
    await tx.providerEvent.update({
      where: { id: providerEventRowId },
      data: {
        referenceId: input.reference?.id,
        outcome: input.outcome,
      },
    });
    await tx.auditEvent.create({
      data: {
        referenceId: input.reference?.id,
        actorType: 'PROVIDER',
        actorId: this.config.provider.actorId,
        action: 'PROVIDER_EVENT',
        result: input.outcome,
        correlationId,
        metadataJson: {
          providerEventId: payload.providerEventId,
          referenceId: payload.referenceId,
          externalReference: payload.externalReference,
          status: payload.status,
          ...input.metadataJson,
        },
      },
    });

    return {
      kind: 'rejected',
      outcome: input.outcome,
      providerEventId: payload.providerEventId,
      code: input.code,
      message: input.message,
      status: input.status,
    };
  }

  private async resolveDuplicateEvent(
    payload: ProviderCallbackDto,
    payloadHash: string,
    correlationId?: string,
  ): Promise<ProviderResult> {
    const existing = await this.prisma.providerEvent.findUnique({
      where: { providerEventId: payload.providerEventId },
    });

    if (!existing) {
      throw new ConflictException({
        code: 'PROVIDER_EVENT_CONFLICT',
        message: 'Provider event could not be resolved safely',
      });
    }

    if (existing.payloadHash !== payloadHash) {
      if (existing.referenceId) {
        await this.prisma.auditEvent.create({
          data: {
            referenceId: existing.referenceId,
            actorType: 'PROVIDER',
            actorId: this.config.provider.actorId,
            action: 'PROVIDER_EVENT',
            result: 'REJECTED_DUPLICATE_PAYLOAD_CONFLICT',
            correlationId,
            metadataJson: {
              providerEventId: payload.providerEventId,
              externalReference: payload.externalReference,
            },
          },
        });
      }

      return {
        kind: 'rejected',
        outcome: 'REJECTED_DUPLICATE_PAYLOAD_CONFLICT',
        providerEventId: payload.providerEventId,
        code: 'PROVIDER_EVENT_CONFLICT',
        message: 'Provider event id was already used with a different payload',
        status: 409,
      };
    }

    if (!existing.referenceId) {
      return {
        kind: 'rejected',
        outcome: existing.outcome,
        providerEventId: payload.providerEventId,
        code:
          existing.outcome === 'REJECTED_NOT_FOUND'
            ? 'REFERENCE_NOT_FOUND'
            : 'PROVIDER_EVENT_CONFLICT',
        message:
          existing.outcome === 'REJECTED_NOT_FOUND'
            ? 'Reference not found'
            : 'Provider event was previously rejected',
        status: existing.outcome === 'REJECTED_NOT_FOUND' ? 404 : 409,
      };
    }

    const reference = await this.prisma.paymentReference.findUnique({
      where: { id: existing.referenceId },
    });

    if (!reference) {
      throw new NotFoundException({
        code: 'REFERENCE_NOT_FOUND',
        message: 'Reference not found',
      });
    }

    await this.prisma.auditEvent.create({
      data: {
        referenceId: reference.id,
        actorType: 'PROVIDER',
        actorId: this.config.provider.actorId,
        action: 'PROVIDER_EVENT_REPLAY',
        result: 'DUPLICATE',
        correlationId,
        metadataJson: {
          providerEventId: payload.providerEventId,
          originalOutcome: existing.outcome,
        },
      },
    });

    if (
      existing.outcome === 'SUCCESS' ||
      existing.outcome === 'ACCEPTED_ALREADY_PAID' ||
      existing.outcome === 'ACCEPTED_ALREADY_CANCELLED'
    ) {
      return {
        kind: 'duplicate',
        outcome: 'DUPLICATE',
        providerEventId: payload.providerEventId,
        reference,
      };
    }

    return {
      kind: 'rejected',
      outcome: existing.outcome,
      providerEventId: payload.providerEventId,
      code: 'PROVIDER_EVENT_CONFLICT',
      message: 'Provider event was previously rejected',
      status: 409,
    };
  }

  private finalizeResult(result: ProviderResult) {
    if (result.kind === 'rejected') {
      if (result.status === 404) {
        throw new NotFoundException({
          code: result.code,
          message: result.message,
        });
      }

      throw new ConflictException({
        code: result.code,
        message: result.message,
      });
    }

    return {
      providerEventId: result.providerEventId,
      outcome: result.outcome,
      duplicate: result.kind === 'duplicate',
      reference: this.serializeReference(result.reference),
    };
  }

  private serializeReference(reference: PaymentReference) {
    return {
      id: reference.id,
      externalReference: reference.externalReference,
      concept: reference.concept,
      amount: Number(reference.amount),
      currency: reference.currency,
      dueDate: reference.dueAt.toISOString(),
      status: getEffectiveReferenceStatus(reference.status, reference.dueAt),
      version: reference.version,
      createdAt: reference.createdAt.toISOString(),
      updatedAt: reference.updatedAt.toISOString(),
      createdBy: {
        id: reference.createdBy,
      },
    };
  }

  private isAlreadyApplied(
    currentStatus: ReferenceStatus,
    incomingStatus: ProviderCallbackDto['status'],
  ) {
    return currentStatus === incomingStatus;
  }

  private createPayloadHash(payload: ProviderCallbackDto) {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  private isUniqueViolation(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
