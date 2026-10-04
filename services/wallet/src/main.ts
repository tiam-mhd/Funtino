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
  installUncaughtExceptionDiagnostics('wallet');
  let stage = 'create_application';
  let app: NestFastifyApplication | undefined;
  try {
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter({ logger: false, bodyLimit: 128_000 }),
    );
    stage = 'register_telemetry';
    installHttpTelemetry(app.getHttpAdapter().getInstance(), {
      service: 'wallet',
      tokenEnvironmentVariable: 'WALLET_METRICS_TOKEN',
    });
    installHttpExceptionDiagnostics(app, 'wallet');
    app.enableShutdownHooks();
    const port = Number(process.env.WALLET_PORT ?? 4070);
    stage = 'listen';
    await app.listen({ port, host: '0.0.0.0' });
    console.info(
      JSON.stringify({
        level: 'info',
        event: 'service.started',
        service: 'wallet',
        environment: process.env.NODE_ENV ?? 'development',
        port,
      }),
    );
  } catch (error) {
    reportStartupFailure('wallet', stage, error);
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
