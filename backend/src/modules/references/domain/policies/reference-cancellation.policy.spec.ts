import { REFERENCE_STATUS } from '../value-objects/reference-status';
import { evaluateCancellationEligibility } from './reference-cancellation.policy';

describe('reference cancellation policy', () => {
  it('allows cancellation only for pending non-expired rows with matching version', () => {
    expect(
      evaluateCancellationEligibility({
        currentStatus: REFERENCE_STATUS.PENDING,
        dueAt: new Date('2026-08-06T12:00:00.000Z'),
        currentVersion: 3,
        expectedVersion: 3,
        now: new Date('2026-08-05T12:00:00.000Z'),
      }),
    ).toEqual({
      allowed: true,
      effectiveStatus: REFERENCE_STATUS.PENDING,
    });
  });

  it('rejects version mismatches, terminal states, and expired references', () => {
    expect(
      evaluateCancellationEligibility({
        currentStatus: REFERENCE_STATUS.PENDING,
        dueAt: new Date('2026-08-06T12:00:00.000Z'),
        currentVersion: 4,
        expectedVersion: 5,
        now: new Date('2026-08-05T12:00:00.000Z'),
      }),
    ).toEqual({
      allowed: false,
      reason: 'VERSION_MISMATCH',
      effectiveStatus: REFERENCE_STATUS.PENDING,
    });

    expect(
      evaluateCancellationEligibility({
        currentStatus: REFERENCE_STATUS.PAID,
        dueAt: new Date('2026-08-06T12:00:00.000Z'),
        currentVersion: 4,
        expectedVersion: 4,
        now: new Date('2026-08-05T12:00:00.000Z'),
      }),
    ).toEqual({
      allowed: false,
      reason: 'INVALID_STATUS',
      effectiveStatus: REFERENCE_STATUS.PAID,
    });

    expect(
      evaluateCancellationEligibility({
        currentStatus: REFERENCE_STATUS.PENDING,
        dueAt: new Date('2026-08-05T11:59:59.000Z'),
        currentVersion: 4,
        expectedVersion: 4,
        now: new Date('2026-08-05T12:00:00.000Z'),
      }),
    ).toEqual({
      allowed: false,
      reason: 'REFERENCE_EXPIRED',
      effectiveStatus: REFERENCE_STATUS.EXPIRED,
    });
  });
});
