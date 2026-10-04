import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  installHttpExceptionDiagnostics,
  installHttpTelemetry,
  installUncaughtExceptionDiagnostics,
} from '@funtino/backend-core';
import { AppModule } from './app.module.js';
import { reportStartupFailure } from './bootstrap/startup-failure.js';

async function bootstrap(): Promise<void> {
  installUncaughtExceptionDiagnostics('customer-household');
  let stage = 'create_application';
  let app: NestFastifyApplication | undefined;
  try {
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter({ logger: false, bodyLimit: 64_000 }),
    );
    stage = 'register_telemetry';
    installHttpTelemetry(app.getHttpAdapter().getInstance(), {
      service: 'customer-household',
      tokenEnvironmentVariable: 'CUSTOMER_HOUSEHOLD_METRICS_TOKEN',
    });
    installHttpExceptionDiagnostics(app, 'customer-household');
    app.enableShutdownHooks();
    stage = 'validate_port';
    const port = Number(process.env.CUSTOMER_HOUSEHOLD_PORT ?? 4080);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error('CUSTOMER_HOUSEHOLD_PORT must be a valid TCP port.');
    }
    stage = 'listen';
    await app.listen({ port, host: '0.0.0.0' });
    console.info(
      JSON.stringify({
        level: 'info',
        event: 'service.started',
        service: 'customer-household',
        environment: process.env.NODE_ENV ?? 'development',
        port,
      }),
    );
  } catch (error) {
    reportStartupFailure('customer-household', stage, error);
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
