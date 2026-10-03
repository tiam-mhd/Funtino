import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AnalyticsProjectionService } from './application/analytics-projection.service.js';
import { OperationsReportService } from './application/operations-report.service.js';
import { AnalyticsEventConsumer } from './infrastructure/messaging/analytics-event-consumer.service.js';
import { PrismaService } from './infrastructure/persistence/prisma/prisma.service.js';
import { AnalyticsReportController } from './interfaces/http/analytics-report.controller.js';
import { AnalyticsHealthController } from './interfaces/http/health.controller.js';
import { AnalyticsServiceTokenGuard } from './interfaces/http/service-token.guard.js';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [AnalyticsReportController, AnalyticsHealthController],
  providers: [
    PrismaService,
    AnalyticsProjectionService,
    OperationsReportService,
    AnalyticsEventConsumer,
    AnalyticsServiceTokenGuard,
  ],
})
export class AppModule {}
