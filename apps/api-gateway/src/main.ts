import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './interfaces/http/api-exception.filter.js';
import { requestContextMiddleware } from './interfaces/http/request-context.middleware.js';
import {
  installHttpRequestContext,
  installHttpTelemetry,
  installUncaughtExceptionDiagnostics,
} from '@funtino/backend-core';

async function bootstrap(): Promise<void> {
  installUncaughtExceptionDiagnostics('api-gateway');
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false, bodyLimit: 2_500_000 }),
  );
  await app.register(cookie);
  await app.register(multipart, {
    limits: { files: 1, fileSize: 2_000_000 },
  });
  app.enableCors({
    origin: (
      process.env.CORS_ORIGINS ??
      'http://localhost:3000,http://localhost:3001,http://localhost:3002'
    )
      .split(',')
      .map((origin) => origin.trim()),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Idempotency-Key',
      'If-Match',
      'X-Request-Id',
      'X-Correlation-Id',
    ],
    exposedHeaders: ['X-Request-Id', 'X-Correlation-Id'],
  });
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onSend', async (_request, reply, payload) => {
      reply.header('x-content-type-options', 'nosniff');
      reply.header('x-frame-options', 'DENY');
      reply.header('referrer-policy', 'no-referrer');
      reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
      return payload;
    });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.getHttpAdapter().getInstance().addHook('onRequest', requestContextMiddleware);
  app.enableShutdownHooks();

  const port = Number(process.env.API_PORT ?? 4000);
  installHttpTelemetry(app.getHttpAdapter().getInstance(), {
    service: 'api-gateway',
    tokenEnvironmentVariable: 'API_METRICS_TOKEN',
  });
  installHttpRequestContext(app, 'api-gateway');
  await app.listen({ port, host: '0.0.0.0' });
  console.info(
    JSON.stringify({
      level: 'info',
      event: 'service.started',
      service: 'api-gateway',
      environment: process.env.NODE_ENV ?? 'development',
      version: process.env.APP_VERSION ?? 'dev',
      port,
    }),
  );
}

void bootstrap();
