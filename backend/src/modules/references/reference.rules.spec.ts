import { ReferenceStatus } from '@prisma/client';
import {
  createIdempotencyFingerprint,
  evaluateCancellationEligibility,
  normalizeCreateReferencePayload,
} from './reference.rules';

describe('reference rules', () => {
  it('allows cancellation only for pending non-expired references with matching version', () => {
    const result = evaluateCancellationEligibility({
      currentStatus: ReferenceStatus.PENDING,
      dueAt: new Date('2026-08-06T12:00:00.000Z'),
      currentVersion: 3,
      expectedVersion: 3,
      now: new Date('2026-08-05T12:00:00.000Z'),
    });

    expect(result).toEqual({
      allowed: true,
      effectiveStatus: ReferenceStatus.PENDING,
    });
  });

  it('rejects cancellation when the current state is terminal or expired', () => {
    expect(
      evaluateCancellationEligibility({
        currentStatus: ReferenceStatus.PAID,
        dueAt: new Date('2026-08-06T12:00:00.000Z'),
        currentVersion: 4,
        expectedVersion: 4,
        now: new Date('2026-08-05T12:00:00.000Z'),
      }),
    ).toEqual({
      allowed: false,
      reason: 'INVALID_STATUS',
      effectiveStatus: ReferenceStatus.PAID,
    });

    expect(
      evaluateCancellationEligibility({
        currentStatus: ReferenceStatus.PENDING,
        dueAt: new Date('2026-08-05T11:59:59.000Z'),
        currentVersion: 4,
        expectedVersion: 4,
        now: new Date('2026-08-05T12:00:00.000Z'),
      }),
    ).toEqual({
      allowed: false,
      reason: 'REFERENCE_EXPIRED',
      effectiveStatus: ReferenceStatus.EXPIRED,
    });
  });

  it('creates the same fingerprint for the same normalized payload', () => {
    const left = createIdempotencyFingerprint(
      normalizeCreateReferencePayload({
        concept: '  Pago   servicio ',
        amount: 125000,
        currency: 'cop',
        dueDate: '2026-08-06T00:00:00.000Z',
      }),
    );
    const right = createIdempotencyFingerprint(
      normalizeCreateReferencePayload({
        concept: 'Pago servicio',
        amount: 125000,
        currency: 'COP',
        dueDate: '2026-08-06T00:00:00.000Z',
      }),
    );
    const different = createIdempotencyFingerprint(
      normalizeCreateReferencePayload({
        concept: 'Pago servicio',
        amount: 125001,
        currency: 'COP',
        dueDate: '2026-08-06T00:00:00.000Z',
      }),
    );

    expect(left).toBe(right);
    expect(left).not.toBe(different);
  });
});
