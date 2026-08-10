import type { AuthLoginOutcome } from '../../../../shared/vocabulary/auth-login-outcomes';

export const AUTH_METRICS_PORT = Symbol('AUTH_METRICS_PORT');

export interface AuthMetricsPort {
  recordLoginAttempt(outcome: AuthLoginOutcome): void;
}
