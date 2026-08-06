import { normalizeApiError } from './errors';

type JsonBody = Record<string, unknown>;

export interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  body?: BodyInit | JsonBody | null;
}

const API_BASE_PATH =
  process.env.NEXT_PUBLIC_API_BASE_PATH?.replace(/\/$/, '') || '/api';

const buildApiUrl = (path: string) => {
  if (!path.startsWith('/')) {
    throw new Error(`Expected API path to start with '/': ${path}`);
  }

  return `${API_BASE_PATH}${path}`;
};

const isRawBody = (value: ApiRequestOptions['body']) =>
  typeof value === 'string' ||
  value instanceof FormData ||
  value instanceof Blob ||
  value instanceof URLSearchParams ||
  value instanceof ArrayBuffer;

const parseResponseBody = async (response: Response) => {
  if (response.status === 204) {
    return undefined;
  }

  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    return response.json();
  }

  const text = await response.text();
  return text.length > 0 ? text : undefined;
};

async function request<T>(path: string, options: ApiRequestOptions = {}) {
  const headers = new Headers(options.headers);
  let body = options.body;

  if (body && !isRawBody(body)) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(body);
  }

  const response = await fetch(buildApiUrl(path), {
    ...options,
    body: body ?? undefined,
    cache: 'no-store',
    credentials: 'include',
    headers,
  });

  const payload = await parseResponseBody(response);

  if (!response.ok) {
    throw normalizeApiError(response, payload);
  }

  return payload as T;
}

export const apiClient = {
  get: <T>(path: string, options?: ApiRequestOptions) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, options?: ApiRequestOptions) =>
    request<T>(path, { ...options, method: 'POST' }),
  request,
};
