import { IDEMPOTENCY_SCOPE } from '../../../../shared/vocabulary/idempotency-scopes';
import {
  buildDeterministicReferenceId,
  createIdempotencyFingerprint,
  normalizeCreateReferencePayload,
} from './reference-idempotency.policy';

describe('reference idempotency policy', () => {
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

    expect(left).toBe(right);
  });

  it('builds the same deterministic reference id for the same scope actor and idempotency key', () => {
    expect(
      buildDeterministicReferenceId(
        IDEMPOTENCY_SCOPE.REFERENCE_CREATE,
        'user-1',
        'intent-1',
      ),
    ).toBe(
      buildDeterministicReferenceId(
        IDEMPOTENCY_SCOPE.REFERENCE_CREATE,
        'user-1',
        'intent-1',
      ),
    );
  });
});
