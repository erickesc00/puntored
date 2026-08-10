import { createHash } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type PaymentReference } from '@prisma/client';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { MetricsService } from '../../../../common/metrics/metrics.service';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { AUDIT_ACTION } from '../../../../shared/vocabulary/audit-actions';
import { AUDIT_RESULT } from '../../../../shared/vocabulary/audit-results';
import { ERROR_CODE } from '../../../../shared/vocabulary/error-codes';
import {
  PROVIDER_EVENT_OUTCOME,
  type ProviderEventOutcome,
} from '../../../../shared/vocabulary/provider-event-outcomes';
import {
  REFERENCES_TRANSITION_PORT,
  type ReferencesTransitionPort,
} from '../../../references/application/ports/references-transition.port';
import { getEffectiveReferenceStatus } from '../../../references/reference.rules';
import { ProviderCallbackDto } from '../../dto/provider-callback.dto';
import type {
  ProviderEventProcessor,
  ProviderEventProcessorResult,
} from '../../application/ports/provider-event-processor.port';

type ProviderResult =
  | {
      kind: 'accepted' | 'already_applied' | 'duplicate';
      outcome: ProviderEventOutcome;
      reference: PaymentReference;
      providerEventId: string;
    }
  | {
      kind: 'rejected';
      outcome: ProviderEventOutcome;
      providerEventId: string;
      code: string;
      message: string;
      status: 404 | 409;
    };

@Injectable()
export class PrismaProviderEventProcessor implements ProviderEventProcessor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly metricsService: MetricsService,
    @Inject(REFERENCES_TRANSITION_PORT)
    private readonly referencesTransitionPort: ReferencesTransitionPort,
  ) {}

  async processProviderEvent(
    payload: ProviderCallbackDto,
    correlationId?: string,
  ): Promise<ProviderEventProcessorResult> {
    const payloadHash = this.createPayloadHash(payload);

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const providerEvent = await tx.providerEvent.create({
          data: {
            providerEventId: payload.providerEventId,
            externalReference: payload.externalReference,
            payloadHash,
            eventType: payload.status,
            outcome: PROVIDER_EVENT_OUTCOME.RECEIVED,
          },
        });

        const transitionResult =
          await this.referencesTransitionPort.applyProviderEventTransition(tx, {
            providerEventId: payload.providerEventId,
            referenceId: payload.referenceId,
            externalReference: payload.externalReference,
            status: payload.status,
            paidAt: payload.paidAt,
            occurredAt: payload.occurredAt,
            correlationId,
          });

        await tx.providerEvent.update({
          where: { id: providerEvent.id },
          data: {
            referenceId: transitionResult.referenceId,
            outcome: transitionResult.outcome,
          },
        });

        if (transitionResult.kind === 'rejected') {
          return {
            kind: 'rejected',
            outcome: transitionResult.outcome,
            providerEventId: payload.providerEventId,
            code: transitionResult.code,
            message: transitionResult.message,
            status: transitionResult.status,
          } satisfies ProviderResult;
        }

        return {
          kind: transitionResult.kind,
          outcome: transitionResult.outcome,
          providerEventId: payload.providerEventId,
          reference: transitionResult.reference,
        } satisfies ProviderResult;
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
        code: ERROR_CODE.PROVIDER_EVENT_CONFLICT,
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
            action: AUDIT_ACTION.PROVIDER_EVENT,
            result: AUDIT_RESULT.REJECTED_DUPLICATE_PAYLOAD_CONFLICT,
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
        outcome: PROVIDER_EVENT_OUTCOME.REJECTED_DUPLICATE_PAYLOAD_CONFLICT,
        providerEventId: payload.providerEventId,
        code: ERROR_CODE.PROVIDER_EVENT_CONFLICT,
        message: 'Provider event id was already used with a different payload',
        status: 409,
      };
    }

    if (!existing.referenceId) {
      return {
        kind: 'rejected',
        outcome: existing.outcome as ProviderEventOutcome,
        providerEventId: payload.providerEventId,
        code:
          existing.outcome === PROVIDER_EVENT_OUTCOME.REJECTED_NOT_FOUND
            ? ERROR_CODE.REFERENCE_NOT_FOUND
            : ERROR_CODE.PROVIDER_EVENT_CONFLICT,
        message:
          existing.outcome === PROVIDER_EVENT_OUTCOME.REJECTED_NOT_FOUND
            ? 'Reference not found'
            : 'Provider event was previously rejected',
        status:
          existing.outcome === PROVIDER_EVENT_OUTCOME.REJECTED_NOT_FOUND
            ? 404
            : 409,
      };
    }

    const reference = await this.prisma.paymentReference.findUnique({
      where: { id: existing.referenceId },
    });

    if (!reference) {
      throw new NotFoundException({
        code: ERROR_CODE.REFERENCE_NOT_FOUND,
        message: 'Reference not found',
      });
    }

    await this.prisma.auditEvent.create({
      data: {
        referenceId: reference.id,
        actorType: 'PROVIDER',
        actorId: this.config.provider.actorId,
        action: AUDIT_ACTION.PROVIDER_EVENT_REPLAY,
        result: AUDIT_RESULT.DUPLICATE,
        correlationId,
        metadataJson: {
          providerEventId: payload.providerEventId,
          originalOutcome: existing.outcome,
        },
      },
    });

    if (
      existing.outcome === PROVIDER_EVENT_OUTCOME.SUCCESS ||
      existing.outcome === PROVIDER_EVENT_OUTCOME.ACCEPTED_ALREADY_PAID ||
      existing.outcome === PROVIDER_EVENT_OUTCOME.ACCEPTED_ALREADY_CANCELLED
    ) {
      return {
        kind: 'duplicate',
        outcome: PROVIDER_EVENT_OUTCOME.DUPLICATE,
        providerEventId: payload.providerEventId,
        reference,
      };
    }

    return {
      kind: 'rejected',
      outcome: existing.outcome as ProviderEventOutcome,
      providerEventId: payload.providerEventId,
      code: ERROR_CODE.PROVIDER_EVENT_CONFLICT,
      message: 'Provider event was previously rejected',
      status: 409,
    };
  }

  private finalizeResult(result: ProviderResult): ProviderEventProcessorResult {
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
