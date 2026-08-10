import { describe, expect, it } from 'vitest';
import {
  buildCreateReferenceFingerprint,
  resolveIdempotencyIntent,
} from './idempotency-intent';

const payload = {
  concept: 'Invoice 1001',
  amount: 125050,
  currency: 'MXN',
  dueDate: '2026-08-20T10:00:00.000Z',
} as const;

describe('idempotency intent', () => {
  it('reuses the same key for the same submission intent', () => {
    const fingerprint = buildCreateReferenceFingerprint(payload);
    const first = resolveIdempotencyIntent(null, fingerprint, () => 'intent-1');
    const second = resolveIdempotencyIntent(first, fingerprint, () => 'intent-2');

    expect(first).toEqual({ key: 'intent-1', fingerprint });
    expect(second).toBe(first);
  });

  it('mints a new key when the payload intent changes', () => {
    const first = resolveIdempotencyIntent(
      null,
      buildCreateReferenceFingerprint(payload),
      () => 'intent-1',
    );
    const second = resolveIdempotencyIntent(
      first,
      buildCreateReferenceFingerprint({
        ...payload,
        amount: 999,
      }),
      () => 'intent-2',
    );

    expect(second).toEqual({
      key: 'intent-2',
      fingerprint: buildCreateReferenceFingerprint({
        ...payload,
        amount: 999,
      }),
    });
  });
});
