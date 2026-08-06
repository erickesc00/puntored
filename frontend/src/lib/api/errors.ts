export interface ApiErrorShape {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  correlationId?: string;
  timestamp?: string;
  path?: string;
}

const FALLBACK_CODE = 'UNKNOWN_ERROR';

export class ApiClientError extends Error implements ApiErrorShape {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;
  readonly correlationId?: string;
  readonly timestamp?: string;
  readonly path?: string;

  constructor(error: ApiErrorShape) {
    super(error.message);
    this.name = 'ApiClientError';
    this.statusCode = error.statusCode;
    this.code = error.code;
    this.details = error.details;
    this.correlationId = error.correlationId;
    this.timestamp = error.timestamp;
    this.path = error.path;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const pickString = (value: unknown, fallback: string) =>
  typeof value === 'string' && value.trim().length > 0 ? value : fallback;

export const normalizeApiError = (
  response: Response,
  payload: unknown,
): ApiClientError => {
  const body = isObject(payload) ? payload : {};

  return new ApiClientError({
    statusCode: response.status,
    code: pickString(body.code, FALLBACK_CODE),
    message: pickString(body.message, response.statusText || 'Request failed'),
    details: body.details,
    correlationId: typeof body.correlationId === 'string' ? body.correlationId : undefined,
    timestamp: typeof body.timestamp === 'string' ? body.timestamp : undefined,
    path: typeof body.path === 'string' ? body.path : undefined,
  });
};

export const isSessionLossError = (error: unknown): error is ApiClientError =>
  error instanceof ApiClientError &&
  (error.code === 'SESSION_REQUIRED' || error.code === 'SESSION_EXPIRED');
