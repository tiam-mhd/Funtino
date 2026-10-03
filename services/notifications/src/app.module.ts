import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health.controller.js';
import { NotificationsProcessor } from './notifications.processor.js';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [HealthController],
  providers: [NotificationsProcessor],
})
export class AppModule {}
