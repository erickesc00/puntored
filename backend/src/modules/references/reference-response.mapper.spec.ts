import { BadRequestException } from '@nestjs/common';
import { ReferenceStatus } from '@prisma/client';
import {
  buildReferenceListWhere,
  decodeCursor,
  encodeCursor,
  serializeReference,
} from './reference-response.mapper';

describe('reference-response.mapper', () => {
  it('serializes overdue pending rows as expired in API responses', () => {
    const now = new Date('2026-08-09T12:00:00.000Z');

    expect(
      serializeReference(
        {
          id: 'ref-1',
          externalReference: null,
          concept: 'Expired by read model',
          amount: BigInt(1000),
          currency: 'MXN',
          dueAt: new Date('2026-08-09T11:00:00.000Z'),
          status: ReferenceStatus.PENDING,
          version: 1,
          createdBy: 'user-1',
          createdAt: new Date('2026-08-09T10:00:00.000Z'),
          updatedAt: new Date('2026-08-09T10:00:00.000Z'),
        },
        now,
      ).status,
    ).toBe(ReferenceStatus.EXPIRED);
  });

  it('builds the expired list filter with persisted and effective overdue pending rows', () => {
    const now = new Date('2026-08-09T12:00:00.000Z');

    expect(
      buildReferenceListWhere({ status: ReferenceStatus.EXPIRED }, now),
    ).toEqual({
      OR: [
        { status: ReferenceStatus.EXPIRED },
        {
          status: ReferenceStatus.PENDING,
          dueAt: { lte: now },
        },
      ],
    });
  });

  it('round-trips cursors and rejects malformed ones', () => {
    const cursor = {
      createdAt: '2026-08-09T12:00:00.000Z',
      id: 'ref-1',
    };

    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    expect(() => decodeCursor('not-valid')).toThrow(BadRequestException);
  });
});
