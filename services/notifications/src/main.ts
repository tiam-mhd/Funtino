import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { installHttpTelemetry } from '@funtino/backend-core';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
  );
  installHttpTelemetry(app.getHttpAdapter().getInstance(), {
    service: 'notifications',
    tokenEnvironmentVariable: 'NOTIFICATIONS_METRICS_TOKEN',
  });
  app.enableShutdownHooks();
  await app.listen({ port: Number(process.env.NOTIFICATIONS_PORT ?? 4030), host: '0.0.0.0' });
  console.info(
    JSON.stringify({
      level: 'info',
      event: 'service.started',
      service: 'notifications',
      environment: process.env.NODE_ENV ?? 'development',
      version: process.env.APP_VERSION ?? 'dev',
      port: Number(process.env.NOTIFICATIONS_PORT ?? 4030),
    }),
  );
}

void bootstrap();
