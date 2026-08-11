import { BadRequestException } from '@nestjs/common';
import { ReferenceCreatorActorType, ReferenceStatus } from '@prisma/client';
import { ERROR_CODE } from '../../shared/vocabulary/error-codes';
import { getEffectiveReferenceStatus } from './reference.rules';
import type { ReferenceRecord } from './application/ports/reference.repository';

interface CursorPayload {
  createdAt: string;
  id: string;
}

export function serializeReference(
  reference: ReferenceRecord,
  now = new Date(),
) {
  return {
    id: reference.id,
    externalReference: reference.externalReference,
    concept: reference.concept,
    amount: Number(reference.amount),
    currency: reference.currency,
    dueDate: reference.dueAt.toISOString(),
    status: getEffectiveReferenceStatus(reference.status, reference.dueAt, now),
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
          id: reference.createdBy ?? reference.creatorActorId,
        },
  };
}

export function serializeProviderReference(
  reference: ReferenceRecord,
  now = new Date(),
) {
  return {
    id: reference.id,
    externalReference: reference.externalReference,
    concept: reference.concept,
    amount: Number(reference.amount),
    currency: reference.currency,
    dueDate: reference.dueAt.toISOString(),
    status: getEffectiveReferenceStatus(reference.status, reference.dueAt, now),
    version: reference.version,
    creatorActorType: reference.creatorActorType,
    creatorActorId: reference.creatorActorId,
    createdAt: reference.createdAt.toISOString(),
    updatedAt: reference.updatedAt.toISOString(),
  };
}

export function isProviderOwnedReference(reference: ReferenceRecord) {
  return reference.creatorActorType === ReferenceCreatorActorType.PROVIDER;
}

export function buildReferenceListWhere(
  query: {
    status?: ReferenceStatus;
    createdFrom?: string;
    createdTo?: string;
    search?: string;
  },
  now: Date,
) {
  const filters: Array<Record<string, unknown>> = [];

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
        ...(query.createdFrom ? { gte: new Date(query.createdFrom) } : {}),
        ...(query.createdTo ? { lte: new Date(query.createdTo) } : {}),
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
    return filters[0] ?? {};
  }

  return { AND: filters };
}

export function encodeCursor(cursor: CursorPayload) {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCursor(cursor?: string) {
  if (!cursor) {
    return null;
  }

  try {
    return JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as CursorPayload;
  } catch {
    throw new BadRequestException({
      code: ERROR_CODE.INVALID_CURSOR,
      message: 'Cursor is invalid',
    });
  }
}
