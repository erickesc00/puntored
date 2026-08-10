'use client';

import { describe, expect, it } from 'vitest';
import { formatDateTime, formatMoney, statusLabel } from './presentation';

describe('reference presentation helpers', () => {
  it('returns human friendly status labels', () => {
    expect(statusLabel('PENDING')).toBe('Pendiente');
    expect(statusLabel('PAID')).toBe('Pagada');
    expect(statusLabel('UNKNOWN')).toBe('UNKNOWN');
  });

  it('formats money amounts from minor units', () => {
    expect(formatMoney(125050, 'COP')).toContain('1.250');
  });

  it('formats datetimes with locale-aware output', () => {
    expect(formatDateTime('2026-08-01T12:00:00.000Z')).toBeTruthy();
  });
});
