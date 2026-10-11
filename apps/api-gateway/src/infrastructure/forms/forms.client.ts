import { Injectable } from '@nestjs/common';
import { DomainError, isRunflareClusterIpServiceBaseUrl } from '@funtino/backend-core';

export type FormsRequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  actorUserId?: string;
  correlationId?: string;
};

@Injectable()
export class FormsClient {
  protected fetcher(input: URL, init: RequestInit): Promise<Response> {
    return fetch(input, init);
  }

  async request(path: string, options: FormsRequestOptions = {}): Promise<unknown> {
    const baseUrl = process.env.FORMS_URL;
    const token = process.env.FORMS_API_GATEWAY_TOKEN;
    if (!baseUrl || !token || token.length < 32 || token.length > 512) {
      throw new DomainError('DEPENDENCY_UNAVAILABLE', 'Forms service is not configured.');
    }

    let url: URL;
    try {
      const base = new URL(baseUrl);
      if (
        !['http:', 'https:'].includes(base.protocol) ||
        base.username ||
        base.password ||
        (process.env.NODE_ENV === 'production' &&
          base.protocol !== 'https:' &&
          !isRunflareClusterIpServiceBaseUrl(base))
      ) {
        throw new Error();
      }
      url = new URL(path, base);
      for (const [key, value] of Object.entries(options.query ?? {})) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    } catch {
      throw new DomainError('DEPENDENCY_UNAVAILABLE', 'Forms service URL is invalid.');
    }

    let response: Response;
    try {
      const headers: Record<string, string> = {
        accept: 'application/json',
        'x-funtino-service-id': 'api-gateway',
        'x-funtino-service-token': token,
        'cache-control': 'no-store',
      };
      if (options.body !== undefined) headers['content-type'] = 'application/json';
      if (options.actorUserId) headers['x-funtino-actor-user-id'] = options.actorUserId;
      if (options.correlationId) headers['x-correlation-id'] = options.correlationId;
      response = await this.fetcher(url, {
        method: options.method ?? 'GET',
        headers,
        redirect: 'error',
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw new DomainError('DEPENDENCY_UNAVAILABLE', 'Forms service is unavailable.');
    }

    if (!response.ok) {
      if (response.status === 400) throw new DomainError('VALIDATION_ERROR', 'Form request is invalid.');
      if (response.status === 401 || response.status === 403) throw new DomainError('FORBIDDEN', 'Form operation is not allowed.');
      if (response.status === 404) throw new DomainError('NOT_FOUND', 'Form resource was not found.');
      if (response.status === 409) throw new DomainError('CONFLICT', 'Form state conflicts with this request.');
      if (response.status === 429) throw new DomainError('RATE_LIMITED', 'Too many form submissions.');
      throw new DomainError('DEPENDENCY_UNAVAILABLE', 'Forms service returned an invalid response.');
    }

    try {
      return await response.json();
    } catch {
      throw new DomainError('DEPENDENCY_UNAVAILABLE', 'Forms service returned an invalid response.');
    }
  }
}
