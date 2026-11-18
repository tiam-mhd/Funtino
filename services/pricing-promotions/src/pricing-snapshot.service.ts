import { Injectable } from '@nestjs/common';

@Injectable()
export class PricingSnapshotService {
  getOfflineSnapshot(branchId: string) {
    return {
      branchId,
      status: 'disabled' as const,
      version: null,
      reasonCode: 'PENDING_WINDOWS_GOLDEN_VECTORS' as const,
      validFrom: null,
      validUntil: null,
      rules: [] as never[],
    };
  }
}
