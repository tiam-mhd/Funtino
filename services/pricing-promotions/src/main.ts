import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { installHttpExceptionDiagnostics, installHttpTelemetry, installUncaughtExceptionDiagnostics } from '@funtino/backend-core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  installUncaughtExceptionDiagnostics('pricing-promotions');
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false, bodyLimit: 128_000 }),
  );
  installHttpTelemetry(app.getHttpAdapter().getInstance(), {
    service: 'pricing-promotions',
    tokenEnvironmentVariable: 'PRICING_METRICS_TOKEN',
  });
  installHttpExceptionDiagnostics(app, 'pricing-promotions');
  app.enableShutdownHooks();
  const port = Number(process.env.PRICING_PORT ?? 4100);
  await app.listen({ port, host: '0.0.0.0' });
  console.info(JSON.stringify({ level: 'info', event: 'service.started', service: 'pricing-promotions', port }));
}

void bootstrap();
