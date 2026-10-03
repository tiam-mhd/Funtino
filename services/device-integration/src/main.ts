import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { installHttpTelemetry } from '@funtino/backend-core';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false, bodyLimit: 128_000 }),
    { rawBody: true },
  );
  installHttpTelemetry(app.getHttpAdapter().getInstance(), {
    service: 'device-integration',
    tokenEnvironmentVariable: 'DEVICE_INTEGRATION_METRICS_TOKEN',
  });
  app.enableShutdownHooks();
  await app.listen({ port: Number(process.env.DEVICE_PORT ?? 4020), host: '0.0.0.0' });
  console.info(
    JSON.stringify({
      level: 'info',
      event: 'service.started',
      service: 'device-integration',
      environment: process.env.NODE_ENV ?? 'development',
      version: process.env.APP_VERSION ?? 'dev',
      port: Number(process.env.DEVICE_PORT ?? 4020),
    }),
  );
}

void bootstrap();
