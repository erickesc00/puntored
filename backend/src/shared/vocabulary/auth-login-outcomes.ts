export const AUTH_LOGIN_OUTCOME = {
  SUCCESS: 'success',
  FAILURE: 'failure',
} as const;

export type AuthLoginOutcome =
  (typeof AUTH_LOGIN_OUTCOME)[keyof typeof AUTH_LOGIN_OUTCOME];
