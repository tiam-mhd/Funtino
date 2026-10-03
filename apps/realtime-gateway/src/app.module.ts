import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health.controller.js';
import { RealtimeGateway } from './realtime.gateway.js';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [HealthController],
  providers: [RealtimeGateway],
})
export class AppModule {}
