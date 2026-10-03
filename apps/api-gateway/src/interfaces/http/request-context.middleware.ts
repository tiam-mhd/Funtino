import type { FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { normalizeCorrelationId } from '@funtino/backend-core';

export function requestContextMiddleware(
  request: FastifyRequest & { requestId?: string; correlationId?: string },
  reply: FastifyReply,
  done: () => void,
): void {
  const requestId = safeRequestId(headerValue(request.headers['x-request-id'])) ?? randomUUID();
  const correlationId = normalizeCorrelationId(
    headerValue(request.headers['x-correlation-id']) ?? requestId,
  );
  request.requestId = requestId;
  request.correlationId = correlationId;
  reply.header('x-request-id', requestId);
  reply.header('x-correlation-id', correlationId);
  done();
}

function safeRequestId(value: string | undefined): string | undefined {
  return value && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : undefined;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
