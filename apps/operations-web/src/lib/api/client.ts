export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

function getApiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error('نشانی API پیکربندی نشده یا معتبر نیست.');
  }

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')
  ) {
    throw new Error('اتصال امن به API پیکربندی نشده است.');
  }
  return url.origin;
}

async function requestApiData<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<{ data: T; nextCursor?: string | null }> {
  let response: Response;
  try {
    response = await fetch(new URL(path, getApiBase()), {
      method: options.method ?? 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: {
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...options.headers,
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } catch {
    throw new ApiRequestError('ارتباط با سرویس برقرار نشد. اتصال را بررسی و دوباره تلاش کنید.', 0);
  }

  const payload = (await response.json().catch(() => null)) as {
    status?: string;
    data?: T;
    nextCursor?: string | null;
    error?: { message?: string; code?: string };
  } | null;
  if (!response.ok || payload?.status !== 'success' || payload.data === undefined) {
    throw new ApiRequestError(
      payload?.error?.message ?? 'ارتباط با سرویس ممکن نشد. اتصال را بررسی و دوباره تلاش کنید.',
      response.status,
      payload?.error?.code,
    );
  }
  return { data: payload.data, nextCursor: payload.nextCursor };
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  return (await requestApiData<T>(path, options)).data;
}

export function apiRequestPage<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<{ data: T; nextCursor: string | null }> {
  return requestApiData<T>(path, options).then(({ data, nextCursor }) => ({
    data,
    nextCursor: nextCursor ?? null,
  }));
}
