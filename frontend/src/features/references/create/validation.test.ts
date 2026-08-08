import { describe, expect, it } from 'vitest';
import { validateCreateReference } from './validation';

describe('validateCreateReference', () => {
  it('converts a decimal amount into backend minor units and preserves the intended local instant', () => {
    const result = validateCreateReference(
      {
        concept: '  Matrícula agosto  ',
        amount: '1250.50',
        currency: 'cop',
        dueDate: '2026-08-20T10:00',
      },
      new Date('2026-08-01T12:00:00.000Z'),
    );

    expect(result.errors).toEqual({});
    expect(result.payload).toEqual({
      concept: 'Matrícula agosto',
      amount: 125050,
      currency: 'COP',
      dueDate: new Date(2026, 7, 20, 10, 0, 0, 0).toISOString(),
    });
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
      currency: 'Ingresa una moneda de tres letras, por ejemplo COP.',
      dueDate: 'Ingresa una fecha y hora de vencimiento válida.',
    });
  });
});
