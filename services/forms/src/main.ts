import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  installHttpExceptionDiagnostics,
  installHttpTelemetry,
  installUncaughtExceptionDiagnostics,
} from '@funtino/backend-core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  installUncaughtExceptionDiagnostics('forms');
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ logger: false }));
  installHttpTelemetry(app.getHttpAdapter().getInstance(), {
    service: 'forms',
    tokenEnvironmentVariable: 'FORMS_METRICS_TOKEN',
  });
  installHttpExceptionDiagnostics(app, 'forms');
  app.enableShutdownHooks();
  const port = Number(process.env.FORMS_PORT ?? 4090);
  await app.listen({ port, host: '0.0.0.0' });
  console.info(JSON.stringify({ level: 'info', event: 'service.started', service: 'forms', port }));
}

void bootstrap();
