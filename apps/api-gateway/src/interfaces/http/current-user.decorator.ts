import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { normalizeCorrelationId } from '@funtino/backend-core';
import type { Session } from '../../domain/models.js';

export type AuthenticatedRequest = FastifyRequest & {
  user: { id: string };
  session?: Session;
  requestId?: string;
  correlationId?: string;
};

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): { id: string } => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.user;
  },
);

export function requestCorrelationId(request: FastifyRequest & { correlationId?: string }): string {
  return normalizeCorrelationId(request.correlationId ?? request.id);
}

export function success<T>(
  data: T,
  request: FastifyRequest & { requestId?: string; correlationId?: string },
): {
  status: 'success';
  data: T;
  meta: { requestId: string | null; correlationId: string | null };
} {
  return {
    status: 'success',
    data,
    meta: {
      requestId: request.requestId ?? null,
      correlationId: request.correlationId ?? null,
    },
  };
}
