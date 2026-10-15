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

export interface ApiPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiEnvelope<T> {
  data: T;
  pagination?: ApiPagination;
}

const getApiBaseUrl = (): string => {
  const configuredBase = import.meta.env.VITE_API_BASE_URL ?? '';
  return configuredBase.replace(/\/$/, '');
};

const buildApiUrl = (path: string): string => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getApiBaseUrl()}${normalizedPath}`;
};

async function requestPayload(path: string, init: RequestInit): Promise<unknown> {
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
    return undefined;
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

  return payload;
}

function hasData(payload: unknown): payload is { data: unknown } {
  return typeof payload === 'object' && payload !== null && 'data' in payload;
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const payload = await requestPayload(path, init);
  return (hasData(payload) ? payload.data : payload) as T;
}

export async function apiRequestEnvelope<T>(
  path: string,
  init: RequestInit = {},
): Promise<ApiEnvelope<T>> {
  const payload = await requestPayload(path, init);
  if (!hasData(payload)) {
    throw new ApiError('The server returned an invalid response.', null);
  }
  let pagination: ApiPagination | undefined;
  if ('pagination' in payload) {
    const value = payload.pagination;
    if (
      typeof value !== 'object' ||
      value === null ||
      !('page' in value) ||
      !('limit' in value) ||
      !('total' in value) ||
      !('totalPages' in value) ||
      typeof value.page !== 'number' ||
      typeof value.limit !== 'number' ||
      typeof value.total !== 'number' ||
      typeof value.totalPages !== 'number' ||
      !Number.isSafeInteger(value.page) ||
      !Number.isSafeInteger(value.limit) ||
      !Number.isSafeInteger(value.total) ||
      !Number.isSafeInteger(value.totalPages)
    ) {
      throw new ApiError('The server returned an invalid response.', null);
    }
    pagination = {
      page: value.page,
      limit: value.limit,
      total: value.total,
      totalPages: value.totalPages,
    };
  }
  return {
    data: payload.data as T,
    ...(pagination ? { pagination } : {}),
  };
}
