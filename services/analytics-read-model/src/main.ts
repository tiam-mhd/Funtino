import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { installHttpTelemetry } from '@funtino/backend-core';
import { reportStartupFailure } from './bootstrap/startup-failure.js';

async function bootstrap(): Promise<void> {
  let stage = 'create_application';
  let app: NestFastifyApplication | undefined;
  try {
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter({ logger: false }),
    );
    stage = 'register_telemetry';
    installHttpTelemetry(app.getHttpAdapter().getInstance(), {
      service: 'analytics-read-model',
      tokenEnvironmentVariable: 'ANALYTICS_METRICS_TOKEN',
    });
    app.enableShutdownHooks();
    const port = Number(process.env.ANALYTICS_PORT ?? process.env.PORT ?? 4060);
    stage = 'listen';
    await app.listen({ port, host: '0.0.0.0' });
    console.info(
      JSON.stringify({
        level: 'info',
        event: 'service.started',
        service: 'analytics-read-model',
        environment: process.env.NODE_ENV ?? 'development',
        port,
      }),
    );
  } catch (error) {
    reportStartupFailure('analytics-read-model', stage, error);
    if (app) {
      try {
        await app.close();
      } catch {
        // Keep the original startup failure as the diagnostic cause.
      }
    }
    process.exitCode = 1;
  }
}

void bootstrap();
