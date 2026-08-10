import { Injectable } from '@nestjs/common';
import { AuditActorType, Prisma, ReferenceStatus } from '@prisma/client';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { AUDIT_ACTION } from '../../../../shared/vocabulary/audit-actions';
import { AUDIT_RESULT } from '../../../../shared/vocabulary/audit-results';
import {
  REFERENCE_AUDIT_ACTION,
  REFERENCE_CREATE_IDEMPOTENCY_TTL_HOURS,
} from '../../domain/references.constants';
import {
  type AppendReferenceAuditEntry,
  type CancelPendingReferenceInput,
  type CreateReferencePersistenceInput,
  type ExpirationCandidate,
  type ExpireResult,
  type ListReferencesQuery,
  type ReferenceRecord,
  type ReferenceRepository,
  type ReferenceStatusSnapshot,
} from '../../application/ports/reference.repository';
import { buildReferenceListWhere } from '../../reference-response.mapper';

@Injectable()
export class PrismaReferenceRepository implements ReferenceRepository {
  constructor(private readonly prisma: PrismaService) {}

  findIdempotencyRecord(
    scope: string,
    actorId: string,
    idempotencyKey: string,
  ) {
    return this.prisma.idempotencyKey.findUnique({
      where: {
        scope_actorId_idempotencyKey: {
          scope,
          actorId,
          idempotencyKey,
        },
      },
      select: {
        requestHash: true,
        referenceId: true,
      },
    });
  }

  findReferenceById(id: string): Promise<ReferenceRecord | null> {
    return this.prisma.paymentReference.findUnique({
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
  }

  findReferenceStatusSnapshot(
    id: string,
  ): Promise<ReferenceStatusSnapshot | null> {
    return this.prisma.paymentReference.findUnique({
      where: { id },
      select: {
        version: true,
        status: true,
        dueAt: true,
      },
    });
  }

  listReferences(query: ListReferencesQuery): Promise<ReferenceRecord[]> {
    const where = buildReferenceListWhere(query, query.now);

    return this.prisma.paymentReference.findMany({
      where: query.cursor
        ? {
            AND: [
              where,
              {
                OR: [
                  {
                    createdAt: {
                      lt: new Date(query.cursor.createdAt),
                    },
                  },
                  {
                    createdAt: new Date(query.cursor.createdAt),
                    id: {
                      lt: query.cursor.id,
                    },
                  },
                ],
              },
            ],
          }
        : where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
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
  }

  listReferenceAuditHistory(referenceId: string) {
    return this.prisma.auditEvent.findMany({
      where: { referenceId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  async appendAuditEvent(entry: AppendReferenceAuditEntry) {
    await this.prisma.auditEvent.create({
      data: {
        referenceId: entry.referenceId,
        actorType: entry.actorType,
        actorId: entry.actorId,
        action: entry.action,
        result: entry.result,
        correlationId: entry.correlationId,
        metadataJson: entry.metadataJson as Prisma.InputJsonValue | undefined,
      },
    });
  }

  persistCreatedReference(input: CreateReferencePersistenceInput) {
    return this.prisma.$transaction(async (tx) => {
      const reference = await tx.paymentReference.create({
        data: {
          ...(input.referenceId ? { id: input.referenceId } : {}),
          concept: input.concept,
          amount: BigInt(input.amount),
          currency: input.currency,
          dueAt: input.dueAt,
          createdBy: input.actorId,
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
          actorType: AuditActorType.USER,
          actorId: input.actorId,
          action: REFERENCE_AUDIT_ACTION.CREATE,
          result: AUDIT_RESULT.SUCCESS,
          correlationId: input.correlationId,
          metadataJson: {
            currency: input.currency,
            externalReference: input.externalReference,
          },
        },
      });

      await tx.idempotencyKey.create({
        data: {
          scope: input.idempotencyScope,
          actorId: input.actorId,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          referenceId: reference.id,
          responseCode: 201,
          expiresAt: new Date(
            Date.now() +
              REFERENCE_CREATE_IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000,
          ),
        },
      });

      return reference;
    });
  }

  cancelPendingReference(input: CancelPendingReferenceInput) {
    return this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.paymentReference.updateMany({
        where: {
          id: input.referenceId,
          version: input.expectedVersion,
          status: ReferenceStatus.PENDING,
          dueAt: {
            gt: input.transitionCutoff,
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
        where: { id: input.referenceId },
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
        return null;
      }

      await tx.auditEvent.create({
        data: {
          referenceId: cancelledReference.id,
          actorType: AuditActorType.USER,
          actorId: input.actorId,
          action: REFERENCE_AUDIT_ACTION.CANCEL,
          result: AUDIT_RESULT.SUCCESS,
          correlationId: input.correlationId,
          metadataJson: {
            expectedVersion: input.expectedVersion,
            newVersion: cancelledReference.version,
          },
        },
      });

      return cancelledReference;
    });
  }

  listOverduePendingReferences(limit: number, now: Date) {
    return this.prisma.paymentReference.findMany({
      where: {
        status: ReferenceStatus.PENDING,
        dueAt: {
          lte: now,
        },
      },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: {
        id: true,
        version: true,
        dueAt: true,
      },
    });
  }

  async expireReferenceIfStillPending(
    candidate: ExpirationCandidate,
    now: Date,
    actorId: string,
  ): Promise<ExpireResult> {
    return this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.paymentReference.updateMany({
        where: {
          id: candidate.id,
          version: candidate.version,
          status: ReferenceStatus.PENDING,
          dueAt: {
            lte: now,
          },
        },
        data: {
          status: ReferenceStatus.EXPIRED,
          version: {
            increment: 1,
          },
        },
      });

      if (updateResult.count === 0) {
        return { expired: false };
      }

      const newVersion = candidate.version + 1;

      await tx.auditEvent.create({
        data: {
          referenceId: candidate.id,
          actorType: AuditActorType.SYSTEM,
          actorId,
          action: AUDIT_ACTION.EXPIRE_REFERENCE,
          result: AUDIT_RESULT.SUCCESS,
          metadataJson: {
            previousVersion: candidate.version,
            newVersion,
            dueAt: candidate.dueAt.toISOString(),
          },
        },
      });

      return {
        expired: true,
        newVersion,
      };
    });
  }
}
