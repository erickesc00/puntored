export interface CreateReferenceFormValues {
  concept: string;
  amount: string;
  currency: string;
  dueDate: string;
}

export interface CreateReferencePayload {
  concept: string;
  amount: number;
  currency: string;
  dueDate: string;
}

export interface CreateReferenceValidationResult {
  payload: CreateReferencePayload | null;
  errors: Partial<Record<keyof CreateReferenceFormValues, string>>;
}

const toUtcIsoFromLocalInput = (value: string) => {
  const normalized = value.trim();
  const match = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/,
  );

  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute] = match;
  const localDate = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    0,
    0,
  );

  return Number.isNaN(localDate.getTime()) ? null : localDate.toISOString();
};

const normalizeConcept = (value: string) => value.trim().replace(/\s+/g, ' ');

const normalizeCurrency = (value: string) => value.trim().toUpperCase();

const parseMinorUnits = (value: string) => {
  const normalized = value.trim().replace(',', '.');

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return null;
  }

  const [whole, decimal = ''] = normalized.split('.');
  return Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
};

export const validateCreateReference = (
  values: CreateReferenceFormValues,
  now = new Date(),
): CreateReferenceValidationResult => {
  const errors: CreateReferenceValidationResult['errors'] = {};
  const concept = normalizeConcept(values.concept);
  const currency = normalizeCurrency(values.currency);
  const minorAmount = parseMinorUnits(values.amount);
  const dueDateIso = values.dueDate ? toUtcIsoFromLocalInput(values.dueDate) : null;
  const dueDate = dueDateIso ? new Date(dueDateIso) : null;

  if (!concept) {
    errors.concept = 'Ingresa un concepto.';
  } else if (concept.length > 255) {
    errors.concept = 'El concepto no puede superar los 255 caracteres.';
  }

  if (minorAmount === null || minorAmount < 1) {
    errors.amount = 'Ingresa un monto válido con hasta dos decimales.';
  }

  if (!/^[A-Z]{3}$/.test(currency)) {
    errors.currency = 'Ingresa una moneda de tres letras, por ejemplo COP.';
  }

  if (!dueDate || Number.isNaN(dueDate.getTime())) {
    errors.dueDate = 'Ingresa una fecha y hora de vencimiento válida.';
  } else if (dueDate.getTime() <= now.getTime()) {
    errors.dueDate = 'La referencia debe vencer en el futuro.';
  }

  if (Object.keys(errors).length > 0) {
    return {
      payload: null,
      errors,
    };
  }

  return {
    payload: {
      concept,
      amount: minorAmount!,
      currency,
      dueDate: dueDateIso!,
    },
    errors: {},
  };
};
