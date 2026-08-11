import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AuditActorType, Prisma, ReferenceCreatorActorType } from '@prisma/client';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { ApplicationHttpError } from '../../../../common/errors/application-http.error';
import { AUDIT_RESULT } from '../../../../shared/vocabulary/audit-results';
import { ERROR_CODE } from '../../../../shared/vocabulary/error-codes';
import { ProviderCreateReferenceDto } from '../../dto/provider-create-reference.dto';
import {
  REFERENCE_METRICS_PORT,
  type ReferenceMetricsPort,
} from '../ports/metrics.port';
import {
  REFERENCE_REPOSITORY,
  type ReferenceRecord,
  type ReferenceRepository,
} from '../ports/reference.repository';
import {
  isProviderOwnedReference,
  serializeProviderReference,
} from '../../reference-response.mapper';
import {
  createIdempotencyFingerprint,
  normalizeCreateReferencePayload,
} from '../../domain/policies/reference-idempotency.policy';
import {
  REFERENCE_AUDIT_ACTION,
  REFERENCE_CREATE_OUTCOME,
} from '../../domain/references.constants';

@Injectable()
export class CreateProviderReferenceUseCase {
  constructor(
    @Inject(REFERENCE_REPOSITORY)
    private readonly repository: ReferenceRepository,
    @Inject(REFERENCE_METRICS_PORT)
    private readonly metrics: ReferenceMetricsPort,
    private readonly config: AppConfigService,
  ) {}

  async execute(payload: ProviderCreateReferenceDto, correlationId?: string) {
    const normalizedPayload = normalizeCreateReferencePayload({
      externalReference: payload.externalReference,
      concept: payload.concept,
      amount: payload.amount,
      currency: payload.currency,
      dueDate: payload.dueDate,
    });
    const normalizedRequest = {
      externalReference: normalizedPayload.externalReference!,
      concept: normalizedPayload.concept,
      amount: normalizedPayload.amount,
      currency: normalizedPayload.currency,
      dueDate: normalizedPayload.dueDate,
    };
    const dueAt = new Date(normalizedPayload.dueDate);

    if (dueAt.getTime() <= Date.now()) {
      this.metrics.recordReferenceCreate(
        REFERENCE_CREATE_OUTCOME.REJECTED_INVALID_DUE_DATE,
      );
      throw new ApplicationHttpError(
        HttpStatus.BAD_REQUEST,
        ERROR_CODE.INVALID_DUE_DATE,
        'dueDate must be in the future',
      );
    }

    const existing = await this.repository.findReferenceByExternalReference(
      normalizedRequest.externalReference,
    );

    if (existing) {
      return this.resolveExisting(existing, normalizedRequest, correlationId);
    }

    try {
      const created = await this.repository.persistProviderCreatedReference({
        actorId: this.config.provider.actorId,
        externalReference: normalizedRequest.externalReference,
        concept: normalizedPayload.concept,
        amount: normalizedPayload.amount,
        currency: normalizedPayload.currency,
        dueAt,
        correlationId,
      });

      this.metrics.recordReferenceCreate(REFERENCE_CREATE_OUTCOME.SUCCESS);
      return {
        statusCode: HttpStatus.CREATED,
        body: serializeProviderReference(created),
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const replayed = await this.repository.findReferenceByExternalReference(
          normalizedRequest.externalReference,
        );

        if (replayed) {
          return this.resolveExisting(replayed, normalizedRequest, correlationId);
        }
      }

      throw error;
    }
  }

  private async resolveExisting(
    existing: ReferenceRecord,
    normalizedPayload: {
      externalReference: string;
      concept: string;
      amount: number;
      currency: string;
      dueDate: string;
    },
    correlationId?: string,
  ) {
    const fingerprint = createIdempotencyFingerprint(normalizedPayload);
    const existingFingerprint = createIdempotencyFingerprint({
      externalReference: existing.externalReference ?? '',
      concept: existing.concept,
      amount: Number(existing.amount),
      currency: existing.currency,
      dueDate: existing.dueAt.toISOString(),
    });

    if (
      !isProviderOwnedReference(existing) ||
      existing.creatorActorId !== this.config.provider.actorId ||
      existingFingerprint !== fingerprint
    ) {
      await this.repository.appendAuditEvent({
        referenceId: existing.id,
        actorType: AuditActorType.PROVIDER,
        actorId: this.config.provider.actorId,
        action: REFERENCE_AUDIT_ACTION.CREATE,
        result: AUDIT_RESULT.REJECTED_EXTERNAL_REFERENCE_CONFLICT,
        correlationId,
        metadataJson: {
          externalReference: normalizedPayload.externalReference,
          currentCreatorActorType: existing.creatorActorType,
          currentCreatorActorId: existing.creatorActorId,
        },
      });
      this.metrics.recordReferenceCreate(
        REFERENCE_CREATE_OUTCOME.REJECTED_EXTERNAL_REFERENCE_CONFLICT,
      );
      throw new ApplicationHttpError(
        HttpStatus.CONFLICT,
        ERROR_CODE.PROVIDER_EXTERNAL_REFERENCE_CONFLICT,
        'Provider external reference conflicts with persisted data',
      );
    }

    await this.repository.appendAuditEvent({
      referenceId: existing.id,
      actorType: AuditActorType.PROVIDER,
      actorId: this.config.provider.actorId,
      action: REFERENCE_AUDIT_ACTION.IDEMPOTENT_REPLAY,
      result: AUDIT_RESULT.SUCCESS,
      correlationId,
      metadataJson: {
        externalReference: normalizedPayload.externalReference,
      },
    });
    this.metrics.recordReferenceCreate(REFERENCE_CREATE_OUTCOME.SUCCESS);

    return {
      statusCode: HttpStatus.OK,
      body: serializeProviderReference(existing),
    };
  }
}
