export class ApiError extends Error {
  status: number | null;
  code?: string;

  constructor(message: string, status: number | null, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

interface ApiErrorResponse {
  error?: {
    code?: unknown;
    message?: unknown;
  };
}

const getApiBaseUrl = (): string => {
  const configuredBase = import.meta.env.VITE_API_BASE_URL ?? '';
  return configuredBase.replace(/\/$/, '');
};

const buildApiUrl = (path: string): string => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getApiBaseUrl()}${normalizedPath}`;
};

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers ?? {});

  if (
    init.body !== undefined &&
    !(init.body instanceof FormData) &&
    !headers.has('Content-Type')
  ) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(buildApiUrl(path), {
      ...init,
      credentials: 'include',
      headers,
    });
  } catch {
    throw new ApiError(
      'Unable to reach the GateWatch server. Please check your connection and try again.',
      null,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get('content-type') ?? '';
  let payload: unknown = null;
  if (contentType.includes('application/json')) {
    try {
      payload = await response.json();
    } catch {
      throw new ApiError('The server returned an invalid response.', response.status);
    }
  }

  if (!response.ok) {
    const errorPayload = (payload as ApiErrorResponse | null)?.error;
    const message =
      typeof errorPayload?.message === 'string'
        ? errorPayload.message
        : 'The request could not be completed.';
    const code =
      typeof errorPayload?.code === 'string' ? errorPayload.code : undefined;
    throw new ApiError(message, response.status, code);
  }

  if (typeof payload === 'object' && payload !== null && 'data' in payload) {
    return (payload as { data: T }).data;
  }

  return payload as T;
}
