import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AuditActorType, Prisma } from '@prisma/client';
import { ApplicationHttpError } from '../../../../common/errors/application-http.error';
import { ERROR_CODE } from '../../../../shared/vocabulary/error-codes';
import { AUDIT_RESULT } from '../../../../shared/vocabulary/audit-results';
import type { SessionAuth } from '../../../auth/guards/session.guard';
import { CreateReferenceDto } from '../../dto/create-reference.dto';
import {
  REFERENCE_METRICS_PORT,
  type ReferenceMetricsPort,
} from '../ports/metrics.port';
import {
  REFERENCE_PROVIDER_ALLOCATION_PORT,
  type ProviderAllocationPort,
} from '../ports/provider-allocation.port';
import {
  REFERENCE_REPOSITORY,
  type ReferenceRepository,
  type StoredIdempotencyRecord,
} from '../ports/reference.repository';
import { serializeReference } from '../../reference-response.mapper';
import {
  buildDeterministicReferenceId,
  createIdempotencyFingerprint,
  normalizeCreateReferencePayload,
} from '../../domain/policies/reference-idempotency.policy';
import {
  REFERENCES_IDEMPOTENCY_SCOPE,
  REFERENCE_AUDIT_ACTION,
  REFERENCE_CREATE_OUTCOME,
} from '../../domain/references.constants';

@Injectable()
export class CreateReferenceUseCase {
  constructor(
    @Inject(REFERENCE_REPOSITORY)
    private readonly repository: ReferenceRepository,
    @Inject(REFERENCE_PROVIDER_ALLOCATION_PORT)
    private readonly providerAllocation: ProviderAllocationPort,
    @Inject(REFERENCE_METRICS_PORT)
    private readonly metrics: ReferenceMetricsPort,
  ) {}

  async execute(
    actor: SessionAuth,
    payload: CreateReferenceDto,
    idempotencyKey: string | undefined,
    correlationId?: string,
  ) {
    const trimmedKey = idempotencyKey?.trim();
    if (!trimmedKey) {
      this.metrics.recordReferenceCreate(
        REFERENCE_CREATE_OUTCOME.REJECTED_MISSING_IDEMPOTENCY_KEY,
      );
      throw new ApplicationHttpError(
        HttpStatus.BAD_REQUEST,
        ERROR_CODE.IDEMPOTENCY_KEY_REQUIRED,
        'Idempotency-Key header is required',
      );
    }

    const normalizedPayload = normalizeCreateReferencePayload({
      concept: payload.concept,
      amount: payload.amount,
      currency: payload.currency,
      dueDate: payload.dueDate,
    });
    const requestHash = createIdempotencyFingerprint(normalizedPayload);
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

    const existing = await this.repository.findIdempotencyRecord(
      REFERENCES_IDEMPOTENCY_SCOPE,
      actor.userId,
      trimmedKey,
    );

    if (existing) {
      return this.resolveExistingIdempotentRequest(
        existing,
        requestHash,
        correlationId,
      );
    }

    const referenceId = this.providerAllocation.isEnabled
      ? buildDeterministicReferenceId(
          REFERENCES_IDEMPOTENCY_SCOPE,
          actor.userId,
          trimmedKey,
        )
      : undefined;

    const providerAllocation = this.providerAllocation.isEnabled
      ? await this.allocateProviderReference(
          referenceId!,
          normalizedPayload,
          correlationId,
        )
      : null;

    try {
      const created = await this.repository.persistCreatedReference({
        actorId: actor.userId,
        concept: normalizedPayload.concept,
        amount: normalizedPayload.amount,
        currency: normalizedPayload.currency,
        dueAt,
        idempotencyScope: REFERENCES_IDEMPOTENCY_SCOPE,
        idempotencyKey: trimmedKey,
        requestHash,
        correlationId,
        referenceId,
        externalReference: providerAllocation?.externalReference ?? null,
      });

      this.metrics.recordReferenceCreate(REFERENCE_CREATE_OUTCOME.SUCCESS);
      return serializeReference(created);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const persisted = await this.repository.findIdempotencyRecord(
          REFERENCES_IDEMPOTENCY_SCOPE,
          actor.userId,
          trimmedKey,
        );

        if (persisted) {
          return this.resolveExistingIdempotentRequest(
            persisted,
            requestHash,
            correlationId,
          );
        }
      }

      throw error;
    }
  }

  private async allocateProviderReference(
    referenceId: string,
    normalizedPayload: {
      concept: string;
      amount: number;
      currency: string;
      dueDate: string;
    },
    correlationId?: string,
  ) {
    try {
      return await this.providerAllocation.allocateReference({
        backendReferenceId: referenceId,
        concept: normalizedPayload.concept,
        amount: normalizedPayload.amount,
        currency: normalizedPayload.currency,
        dueDate: normalizedPayload.dueDate,
      });
    } catch (error) {
      this.metrics.recordReferenceCreate(
        REFERENCE_CREATE_OUTCOME.REJECTED_PROVIDER_ALLOCATION_FAILED,
      );

      if (correlationId) {
        await this.repository.appendAuditEvent({
          actorType: AuditActorType.USER,
          action: REFERENCE_AUDIT_ACTION.CREATE,
          result: AUDIT_RESULT.REJECTED_PROVIDER_ALLOCATION_FAILED,
          correlationId,
          metadataJson: {
            referenceId,
          },
        });
      }

      throw error;
    }
  }

  private async resolveExistingIdempotentRequest(
    existing: StoredIdempotencyRecord,
    requestHash: string,
    correlationId?: string,
  ) {
    if (existing.requestHash !== requestHash) {
      if (existing.referenceId) {
        await this.repository.appendAuditEvent({
          referenceId: existing.referenceId,
          actorType: AuditActorType.USER,
          action: REFERENCE_AUDIT_ACTION.CREATE,
          result: AUDIT_RESULT.REJECTED_IDEMPOTENCY_CONFLICT,
          correlationId,
        });
      }

      this.metrics.recordReferenceCreate(
        REFERENCE_CREATE_OUTCOME.REJECTED_IDEMPOTENCY_CONFLICT,
      );
      throw new ApplicationHttpError(
        HttpStatus.CONFLICT,
        ERROR_CODE.IDEMPOTENCY_CONFLICT,
        'Idempotency key was already used with a different payload',
      );
    }

    if (!existing.referenceId) {
      this.metrics.recordReferenceCreate(
        REFERENCE_CREATE_OUTCOME.REJECTED_UNRESOLVABLE_REPLAY,
      );
      throw new ApplicationHttpError(
        HttpStatus.CONFLICT,
        ERROR_CODE.IDEMPOTENCY_CONFLICT,
        'Idempotent response could not be resolved',
      );
    }

    const reference = await this.repository.findReferenceById(
      existing.referenceId,
    );

    if (!reference) {
      throw new ApplicationHttpError(
        HttpStatus.CONFLICT,
        ERROR_CODE.REFERENCE_NOT_FOUND,
        'Reference not found',
      );
    }

      await this.repository.appendAuditEvent({
        referenceId: reference.id,
        actorType: AuditActorType.USER,
        actorId: reference.createdBy ?? reference.creatorActorId,
        action: REFERENCE_AUDIT_ACTION.IDEMPOTENT_REPLAY,
        result: AUDIT_RESULT.SUCCESS,
        correlationId,
    });

    this.metrics.recordReferenceCreate(REFERENCE_CREATE_OUTCOME.SUCCESS);
    return serializeReference(reference);
  }
}
