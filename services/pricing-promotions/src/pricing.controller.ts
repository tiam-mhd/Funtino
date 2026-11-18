import { Controller, Get, Header, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { PricingSnapshotService } from './pricing-snapshot.service.js';
import { PricingDeviceTokenGuard } from './pricing-device-token.guard.js';

@Controller('internal/v1/branches')
@UseGuards(PricingDeviceTokenGuard)
export class PricingController {
  constructor(private readonly pricing: PricingSnapshotService) {}

  @Get(':branchId/offline-snapshot')
  @Header('cache-control', 'private, no-store')
  getOfflineSnapshot(@Param('branchId', new ParseUUIDPipe()) branchId: string) {
    return this.pricing.getOfflineSnapshot(branchId);
  }
}
