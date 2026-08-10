export const SUPPORTED_CURRENCIES = ['COP', 'MXN', 'USD', 'EUR'] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];
