import { Injectable } from '@nestjs/common';
import { AuditActorType, ReferenceStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface ExpirationCandidate {
  id: string;
  version: number;
  dueAt: Date;
}

export interface ExpireResult {
  expired: boolean;
  newVersion?: number;
}

@Injectable()
export class ReferenceExpirationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listOverduePending(limit: number, now: Date) {
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

  async expireIfStillPending(
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
          action: 'EXPIRE_REFERENCE',
          result: 'SUCCESS',
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
