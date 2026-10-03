export type ApiEnvelope<T> = {
  status: 'success';
  data: T;
};

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
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
    throw new Error('آدرس API پیکربندی معتبر ندارد.');
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

export async function apiRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  const response = await fetch(new URL(path, getApiBase()), {
    method: options.method ?? 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const result = (await response.json().catch(() => null)) as
    | (ApiEnvelope<T> & { error?: { message?: string } })
    | null;
  if (!response.ok || !result || result.status !== 'success') {
    throw new ApiRequestError(
      result?.error?.message ?? 'ارتباط با سرویس ممکن نشد. دوباره تلاش کنید.',
      response.status,
    );
  }
  return result.data;
}
