import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health.controller.js';
import { PrismaService } from './prisma.service.js';
import { PricingController } from './pricing.controller.js';
import { PricingSnapshotService } from './pricing-snapshot.service.js';
import { PricingDeviceTokenGuard } from './pricing-device-token.guard.js';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [HealthController, PricingController],
  providers: [PrismaService, PricingSnapshotService, PricingDeviceTokenGuard],
})
export class AppModule {}
