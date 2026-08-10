import { describe, expect, it } from 'vitest';
import { SUPPORTED_CURRENCIES, validateCreateReference } from './validation';

describe('validateCreateReference', () => {
  it('converts a decimal amount into backend minor units and preserves the intended local instant', () => {
    const result = validateCreateReference(
      {
        concept: '  Matrícula agosto  ',
        amount: '1250.50',
        currency: 'mxn',
        dueDate: '2026-08-20T10:00',
      },
      new Date('2026-08-01T12:00:00.000Z'),
    );

    expect(result.errors).toEqual({});
    expect(result.payload).toEqual({
      concept: 'Matrícula agosto',
      amount: 125050,
      currency: 'MXN',
      dueDate: new Date(2026, 7, 20, 10, 0, 0, 0).toISOString(),
    });
  });

  it.each(SUPPORTED_CURRENCIES)('accepts supported currency %s', (currency) => {
    const result = validateCreateReference(
      {
        concept: 'Matrícula agosto',
        amount: '1250.50',
        currency,
        dueDate: '2026-08-20T10:00',
      },
      new Date('2026-08-01T12:00:00.000Z'),
    );

    expect(result.errors.currency).toBeUndefined();
    expect(result.payload?.currency).toBe(currency);
  });

  it('reports field-level validation errors for invalid input', () => {
    const result = validateCreateReference(
      {
        concept: ' ',
        amount: '0',
        currency: 'peso',
        dueDate: 'invalid-date',
      },
      new Date('2026-08-01T12:00:00.000Z'),
    );

    expect(result.payload).toBeNull();
    expect(result.errors).toEqual({
      concept: 'Ingresa un concepto.',
      amount: 'Ingresa un monto válido con hasta dos decimales.',
      currency: 'Selecciona una moneda válida: MXN, COP, USD o EUR.',
      dueDate: 'Ingresa una fecha y hora de vencimiento válida.',
    });
  });

  it('rejects unsupported currencies even if they are three-letter uppercase codes', () => {
    const result = validateCreateReference(
      {
        concept: 'Matrícula agosto',
        amount: '1250.50',
        currency: 'JPY',
        dueDate: '2026-08-20T10:00',
      },
      new Date('2026-08-01T12:00:00.000Z'),
    );

    expect(result.payload).toBeNull();
    expect(result.errors.currency).toBe(
      'Selecciona una moneda válida: MXN, COP, USD o EUR.',
    );
  });
});
