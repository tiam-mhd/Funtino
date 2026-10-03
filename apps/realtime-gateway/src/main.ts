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
    service: 'realtime-gateway',
    tokenEnvironmentVariable: 'REALTIME_METRICS_TOKEN',
  });
  app.enableCors({
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(','),
    credentials: true,
  });
  app.enableShutdownHooks();
  await app.listen({ port: Number(process.env.REALTIME_PORT ?? 4010), host: '0.0.0.0' });
  console.info(
    JSON.stringify({
      level: 'info',
      event: 'service.started',
      service: 'realtime-gateway',
      environment: process.env.NODE_ENV ?? 'development',
      version: process.env.APP_VERSION ?? 'dev',
      port: Number(process.env.REALTIME_PORT ?? 4010),
    }),
  );
}

void bootstrap();
