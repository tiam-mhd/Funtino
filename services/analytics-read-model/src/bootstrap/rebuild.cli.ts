import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { AnalyticsProjectionService } from '../application/analytics-projection.service.js';

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['error', 'warn', 'log'],
});
try {
  const result = await app.get(AnalyticsProjectionService).rebuild();
  process.stdout.write(
    `Analytics projection rebuilt: generation=${result.generationId}, events=${result.replayedEvents}, watermark=${result.highWatermark}\n`,
  );
} catch (error) {
  process.stderr.write(
    `Analytics rebuild failed: ${error instanceof Error ? error.name : 'unknown'}\n`,
  );
  process.exitCode = 1;
} finally {
  await app.close();
}
