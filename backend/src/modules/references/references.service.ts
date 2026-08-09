import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ReferenceStatus, UserRole } from '@prisma/client';
import { MetricsService } from '../../common/metrics/metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { SessionAuth } from '../auth/guards/session.guard';
import { CancelReferenceDto } from './dto/cancel-reference.dto';
import { CreateReferenceDto } from './dto/create-reference.dto';
import { ListReferencesDto } from './dto/list-references.dto';
import {
  REFERENCES_IDEMPOTENCY_SCOPE,
  buildDeterministicReferenceId,
  createIdempotencyFingerprint,
  evaluateCancellationEligibility,
  getEffectiveReferenceStatus,
  normalizeCreateReferencePayload,
} from './reference.rules';
import { ProviderAllocationClient } from './provider-client';

interface CursorPayload {
  createdAt: string;
  id: string;
}

interface ReferenceRecord {
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
  creator?: {
    id: string;
    username: string;
    role: UserRole;
  };
}

@Injectable()
export class ReferencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metricsService: MetricsService,
    private readonly providerAllocationClient: ProviderAllocationClient,
  ) {}

  async createReference(
    actor: SessionAuth,
    payload: CreateReferenceDto,
    idempotencyKey: string | undefined,
    correlationId?: string,
  ) {
    const trimmedKey = idempotencyKey?.trim();
    if (!trimmedKey) {
      this.metricsService.recordReferenceCreate(
        'rejected_missing_idempotency_key',
      );
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'Idempotency-Key header is required',
      });
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
      this.metricsService.recordReferenceCreate('rejected_invalid_due_date');
      throw new BadRequestException({
        code: 'INVALID_DUE_DATE',
        message: 'dueDate must be in the future',
      });
    }

    const existing = await this.prisma.idempotencyKey.findUnique({
      where: {
        scope_actorId_idempotencyKey: {
          scope: REFERENCES_IDEMPOTENCY_SCOPE,
          actorId: actor.userId,
          idempotencyKey: trimmedKey,
        },
      },
    });

    if (existing) {
      return this.resolveExistingIdempotentRequest(
        existing,
        requestHash,
        correlationId,
      );
    }

    const referenceId = this.providerAllocationClient.isEnabled
      ? buildDeterministicReferenceId(
          REFERENCES_IDEMPOTENCY_SCOPE,
          actor.userId,
          trimmedKey,
        )
      : undefined;

    const providerAllocation = this.providerAllocationClient.isEnabled
      ? await this.allocateProviderReference(
          referenceId!,
          normalizedPayload,
          correlationId,
        )
      : null;

    try {
      const created = await this.persistCreatedReference({
        actor,
        normalizedPayload,
        dueAt,
        trimmedKey,
        requestHash,
        correlationId,
        referenceId,
        externalReference: providerAllocation?.externalReference ?? null,
      });

      this.metricsService.recordReferenceCreate('success');
      return this.serializeReference(created);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const persisted = await this.prisma.idempotencyKey.findUnique({
          where: {
            scope_actorId_idempotencyKey: {
              scope: REFERENCES_IDEMPOTENCY_SCOPE,
              actorId: actor.userId,
              idempotencyKey: trimmedKey,
            },
          },
        });

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
      return await this.providerAllocationClient.allocateReference({
        backendReferenceId: referenceId,
        concept: normalizedPayload.concept,
        amount: normalizedPayload.amount,
        currency: normalizedPayload.currency,
        dueDate: normalizedPayload.dueDate,
      });
    } catch (error) {
      this.metricsService.recordReferenceCreate(
        'rejected_provider_allocation_failed',
      );

      if (correlationId) {
        await this.prisma.auditEvent.create({
          data: {
            actorType: 'USER',
            action: 'CREATE_REFERENCE',
            result: 'REJECTED_PROVIDER_ALLOCATION_FAILED',
            correlationId,
            metadataJson: {
              referenceId,
            },
          },
        });
      }

      throw error;
    }
  }

  async listReferences(query: ListReferencesDto) {
    const limit = query.limit ?? 20;
    const now = new Date();
    const where = this.buildListWhere(query, now);
    const cursor = this.decodeCursor(query.cursor);

    const references = await this.prisma.paymentReference.findMany({
      where: cursor
        ? {
            AND: [
              where,
              {
                OR: [
                  {
                    createdAt: {
                      lt: new Date(cursor.createdAt),
                    },
                  },
                  {
                    createdAt: new Date(cursor.createdAt),
                    id: {
                      lt: cursor.id,
                    },
                  },
                ],
              },
            ],
          }
        : where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: {
        creator: {
          select: {
            id: true,
            username: true,
            role: true,
          },
        },
      },
    });

    const hasMore = references.length > limit;
    const items = references
      .slice(0, limit)
      .map((reference) => this.serializeReference(reference, now));
    const lastItem = references[limit - 1];

    return {
      items,
      pageInfo: {
        nextCursor:
          hasMore && lastItem
            ? this.encodeCursor({
                createdAt: lastItem.createdAt.toISOString(),
                id: lastItem.id,
              })
            : null,
      },
    };
  }

  async getReferenceDetail(id: string) {
    const reference = await this.prisma.paymentReference.findUnique({
      where: { id },
      include: {
        creator: {
          select: {
            id: true,
            username: true,
            role: true,
          },
        },
      },
    });

    if (!reference) {
      throw new NotFoundException({
        code: 'REFERENCE_NOT_FOUND',
        message: 'Reference not found',
      });
    }

    const history = await this.prisma.auditEvent.findMany({
      where: { referenceId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    return {
      reference: this.serializeReference(reference),
      history: history.map((event) => ({
        id: event.id,
        actorType: event.actorType,
        actorId: event.actorId,
        action: event.action,
        result: event.result,
        correlationId: event.correlationId,
        metadata: event.metadataJson,
        createdAt: event.createdAt.toISOString(),
      })),
    };
  }

  async cancelReference(
    id: string,
    payload: CancelReferenceDto,
    actor: SessionAuth,
    correlationId?: string,
  ) {
    const reference = await this.prisma.paymentReference.findUnique({
      where: { id },
      include: {
        creator: {
          select: {
            id: true,
            username: true,
            role: true,
          },
        },
      },
    });

    if (!reference) {
      this.metricsService.recordReferenceCancel('rejected_not_found');
      await this.prisma.auditEvent.create({
        data: {
          actorType: 'USER',
          actorId: actor.userId,
          action: 'CANCEL_ATTEMPT',
          result: 'REJECTED_NOT_FOUND',
          correlationId,
          metadataJson: {
            referenceId: id,
            expectedVersion: payload.version,
          },
        },
      });

      throw new NotFoundException({
        code: 'REFERENCE_NOT_FOUND',
        message: 'Reference not found',
      });
    }

    await this.prisma.auditEvent.create({
      data: {
        referenceId: reference.id,
        actorType: 'USER',
        actorId: actor.userId,
        action: 'CANCEL_ATTEMPT',
        result: 'STARTED',
        correlationId,
        metadataJson: {
          expectedVersion: payload.version,
          currentVersion: reference.version,
        },
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
          ? 'REJECTED_VERSION_CONFLICT'
          : eligibility.reason === 'REFERENCE_EXPIRED'
            ? 'REJECTED_EXPIRED'
            : 'REJECTED_INVALID_STATUS';

      await this.prisma.auditEvent.create({
        data: {
          referenceId: reference.id,
          actorType: 'USER',
          actorId: actor.userId,
          action: 'CANCEL_REFERENCE',
          result,
          correlationId,
          metadataJson: {
            expectedVersion: payload.version,
            currentVersion: reference.version,
            currentStatus: eligibility.effectiveStatus,
          },
        },
      });

      if (eligibility.reason === 'VERSION_MISMATCH') {
        this.metricsService.recordReferenceCancel('rejected_version_conflict');
        throw new ConflictException({
          code: 'REFERENCE_VERSION_CONFLICT',
          message: 'Reference version conflict',
        });
      }

      this.metricsService.recordReferenceCancel(
        eligibility.reason === 'REFERENCE_EXPIRED'
          ? 'rejected_expired'
          : 'rejected_invalid_state',
      );
      throw new ConflictException({
        code:
          eligibility.reason === 'REFERENCE_EXPIRED'
            ? 'REFERENCE_EXPIRED'
            : 'INVALID_REFERENCE_STATE',
        message:
          eligibility.reason === 'REFERENCE_EXPIRED'
            ? 'Expired references cannot be cancelled'
            : 'Reference cannot be cancelled from the current state',
      });
    }

    const transitionCutoff = new Date();

    const cancellationResult = await this.prisma.$transaction(async (tx) => {
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
          status: ReferenceStatus.CANCELLED,
          version: {
            increment: 1,
          },
        },
      });

      if (updateResult.count === 0) {
        return null;
      }

      const cancelledReference = await tx.paymentReference.findUnique({
        where: { id: reference.id },
        include: {
          creator: {
            select: {
              id: true,
              username: true,
              role: true,
            },
          },
        },
      });

      if (!cancelledReference) {
        throw new NotFoundException({
          code: 'REFERENCE_NOT_FOUND',
          message: 'Reference not found',
        });
      }

      await tx.auditEvent.create({
        data: {
          referenceId: cancelledReference.id,
          actorType: 'USER',
          actorId: actor.userId,
          action: 'CANCEL_REFERENCE',
          result: 'SUCCESS',
          correlationId,
          metadataJson: {
            expectedVersion: payload.version,
            newVersion: cancelledReference.version,
          },
        },
      });

      return cancelledReference;
    });

    if (!cancellationResult) {
      const persistedReference = await this.prisma.paymentReference.findUnique({
        where: { id: reference.id },
        select: {
          version: true,
          status: true,
          dueAt: true,
        },
      });

      const currentStatus = persistedReference
        ? getEffectiveReferenceStatus(
            persistedReference.status,
            persistedReference.dueAt,
          )
        : reference.status;
      const expiredDuringTransition = currentStatus === ReferenceStatus.EXPIRED;

      await this.prisma.auditEvent.create({
        data: {
          referenceId: reference.id,
          actorType: 'USER',
          actorId: actor.userId,
          action: 'CANCEL_REFERENCE',
          result: expiredDuringTransition
            ? 'REJECTED_EXPIRED'
            : 'REJECTED_VERSION_CONFLICT',
          correlationId,
          metadataJson: {
            expectedVersion: payload.version,
            currentVersion: persistedReference?.version ?? reference.version,
            currentStatus,
          },
        },
      });

      this.metricsService.recordReferenceCancel(
        expiredDuringTransition
          ? 'rejected_expired'
          : 'rejected_version_conflict',
      );

      if (expiredDuringTransition) {
        throw new ConflictException({
          code: 'REFERENCE_EXPIRED',
          message: 'Expired references cannot be cancelled',
        });
      }

      throw new ConflictException({
        code: 'REFERENCE_VERSION_CONFLICT',
        message: 'Reference version conflict',
      });
    }

    this.metricsService.recordReferenceCancel('success');
    return this.serializeReference(cancellationResult);
  }

  private async resolveExistingIdempotentRequest(
    existing: {
      requestHash: string;
      referenceId: string | null;
    },
    requestHash: string,
    correlationId?: string,
  ) {
    if (existing.requestHash !== requestHash) {
      if (existing.referenceId) {
        await this.prisma.auditEvent.create({
          data: {
            referenceId: existing.referenceId,
            actorType: 'USER',
            action: 'CREATE_REFERENCE',
            result: 'REJECTED_IDEMPOTENCY_CONFLICT',
            correlationId,
          },
        });
      }

      this.metricsService.recordReferenceCreate(
        'rejected_idempotency_conflict',
      );
      throw new ConflictException({
        code: 'IDEMPOTENCY_CONFLICT',
        message: 'Idempotency key was already used with a different payload',
      });
    }

    if (!existing.referenceId) {
      this.metricsService.recordReferenceCreate('rejected_unresolvable_replay');
      throw new ConflictException({
        code: 'IDEMPOTENCY_CONFLICT',
        message: 'Idempotent response could not be resolved',
      });
    }

    const reference = await this.prisma.paymentReference.findUnique({
      where: { id: existing.referenceId },
      include: {
        creator: {
          select: {
            id: true,
            username: true,
            role: true,
          },
        },
      },
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
        actorType: 'USER',
        actorId: reference.createdBy,
        action: 'IDEMPOTENT_REPLAY',
        result: 'SUCCESS',
        correlationId,
      },
    });

    this.metricsService.recordReferenceCreate('success');
    return this.serializeReference(reference);
  }

  private persistCreatedReference(input: {
    actor: SessionAuth;
    normalizedPayload: {
      concept: string;
      amount: number;
      currency: string;
      dueDate: string;
    };
    dueAt: Date;
    trimmedKey: string;
    requestHash: string;
    correlationId?: string;
    referenceId?: string;
    externalReference?: string | null;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const reference = await tx.paymentReference.create({
        data: {
          ...(input.referenceId ? { id: input.referenceId } : {}),
          concept: input.normalizedPayload.concept,
          amount: BigInt(input.normalizedPayload.amount),
          currency: input.normalizedPayload.currency,
          dueAt: input.dueAt,
          createdBy: input.actor.userId,
          ...(input.externalReference
            ? { externalReference: input.externalReference }
            : {}),
        },
        include: {
          creator: {
            select: {
              id: true,
              username: true,
              role: true,
            },
          },
        },
      });

      await tx.auditEvent.create({
        data: {
          referenceId: reference.id,
          actorType: 'USER',
          actorId: input.actor.userId,
          action: 'CREATE_REFERENCE',
          result: 'SUCCESS',
          correlationId: input.correlationId,
          metadataJson: {
            currency: input.normalizedPayload.currency,
            externalReference: input.externalReference,
          },
        },
      });

      await tx.idempotencyKey.create({
        data: {
          scope: REFERENCES_IDEMPOTENCY_SCOPE,
          actorId: input.actor.userId,
          idempotencyKey: input.trimmedKey,
          requestHash: input.requestHash,
          referenceId: reference.id,
          responseCode: 201,
          expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
        },
      });

      return reference;
    });
  }

  private buildListWhere(
    query: ListReferencesDto,
    now: Date,
  ): Prisma.PaymentReferenceWhereInput {
    const filters: Prisma.PaymentReferenceWhereInput[] = [];

    if (query.status) {
      if (query.status === ReferenceStatus.PENDING) {
        filters.push({
          status: ReferenceStatus.PENDING,
          dueAt: { gt: now },
        });
      } else if (query.status === ReferenceStatus.EXPIRED) {
        filters.push({
          OR: [
            { status: ReferenceStatus.EXPIRED },
            {
              status: ReferenceStatus.PENDING,
              dueAt: { lte: now },
            },
          ],
        });
      } else {
        filters.push({ status: query.status });
      }
    }

    if (query.createdFrom || query.createdTo) {
      filters.push({
        createdAt: {
          ...(query.createdFrom
            ? { gte: new Date(query.createdFrom) }
            : undefined),
          ...(query.createdTo ? { lte: new Date(query.createdTo) } : undefined),
        },
      });
    }

    if (query.search?.trim()) {
      const search = query.search.trim();
      filters.push({
        OR: [
          {
            concept: {
              contains: search,
            },
          },
          {
            externalReference: {
              contains: search,
            },
          },
        ],
      });
    }

    if (filters.length === 0) {
      return {};
    }

    if (filters.length === 1) {
      return filters[0]!;
    }

    return { AND: filters };
  }

  private serializeReference(reference: ReferenceRecord, now = new Date()) {
    return {
      id: reference.id,
      externalReference: reference.externalReference,
      concept: reference.concept,
      amount: Number(reference.amount),
      currency: reference.currency,
      dueDate: reference.dueAt.toISOString(),
      status: getEffectiveReferenceStatus(
        reference.status,
        reference.dueAt,
        now,
      ),
      version: reference.version,
      createdAt: reference.createdAt.toISOString(),
      updatedAt: reference.updatedAt.toISOString(),
      createdBy: reference.creator
        ? {
            id: reference.creator.id,
            username: reference.creator.username,
            role: reference.creator.role,
          }
        : {
            id: reference.createdBy,
          },
    };
  }

  private encodeCursor(cursor: CursorPayload) {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
  }

  private decodeCursor(cursor?: string) {
    if (!cursor) {
      return null;
    }

    try {
      return JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf8'),
      ) as CursorPayload;
    } catch {
      throw new BadRequestException({
        code: 'INVALID_CURSOR',
        message: 'Cursor is invalid',
      });
    }
  }

  private isUniqueViolation(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
