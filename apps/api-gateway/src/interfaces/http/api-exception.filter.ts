import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { DomainError } from '@funtino/backend-core';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<FastifyReply>();
    const request = host
      .switchToHttp()
      .getRequest<FastifyRequest & { requestId?: string; correlationId?: string }>();

    const result = toErrorResponse(exception);
    response
      .status(result.statusCode)
      .header('x-request-id', request.requestId ?? '')
      .header('x-correlation-id', request.correlationId ?? '')
      .send({
        status: 'error',
        error: result.error,
        meta: {
          requestId: request.requestId ?? null,
          correlationId: request.correlationId ?? null,
        },
      });
  }
}

function toErrorResponse(exception: unknown): {
  statusCode: number;
  error: { code: string; message: string; details?: unknown };
} {
  if (exception instanceof DomainError) {
    return {
      statusCode: exception.status,
      error: { code: exception.code, message: exception.message, details: exception.details },
    };
  }

  if (exception instanceof HttpException) {
    const statusCode = exception.getStatus();
    const body = exception.getResponse();
    if (typeof body === 'object' && body !== null && 'error' in body) {
      const error = (body as { error: unknown }).error;
      if (typeof error === 'object' && error !== null && 'code' in error && 'message' in error) {
        return { statusCode, error: error as { code: string; message: string; details?: unknown } };
      }
    }
    return {
      statusCode,
      error: {
        code: statusCode === 400 ? 'VALIDATION_ERROR' : 'HTTP_ERROR',
        message: typeof body === 'string' ? body : 'درخواست قابل پردازش نیست.',
      },
    };
  }

  console.error(exception);
  return {
    statusCode: 500,
    error: { code: 'INTERNAL_ERROR', message: 'خطای غیرمنتظره‌ای رخ داد.' },
  };
}
