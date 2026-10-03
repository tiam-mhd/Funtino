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
      new FastifyAdapter({ logger: false, bodyLimit: 64_000 }),
    );
    stage = 'register_telemetry';
    installHttpTelemetry(app.getHttpAdapter().getInstance(), {
      service: 'identity-access',
      tokenEnvironmentVariable: 'IDENTITY_ACCESS_METRICS_TOKEN',
    });
    app.enableShutdownHooks();
    stage = 'validate_port';
    const port = Number(process.env.IDENTITY_ACCESS_PORT ?? 4040);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error('IDENTITY_ACCESS_PORT must be a valid TCP port.');
    }
    stage = 'listen';
    await app.listen({ port, host: '0.0.0.0' });
    console.info(
      JSON.stringify({
        level: 'info',
        event: 'service.started',
        service: 'identity-access',
        environment: process.env.NODE_ENV ?? 'development',
        port,
      }),
    );
  } catch (error) {
    reportStartupFailure('identity-access', stage, error);
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
