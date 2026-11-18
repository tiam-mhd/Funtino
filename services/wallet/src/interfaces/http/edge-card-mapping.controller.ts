import { Controller, Get, Header, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { CardLedgerService } from '../../application/card-ledger.service.js';
import { WalletDeviceIntegrationTokenGuard } from './device-integration-token.guard.js';

@Controller('internal/v1/organizations/:organizationId/branches/:branchId/edge-card-mappings')
@UseGuards(WalletDeviceIntegrationTokenGuard)
export class EdgeCardMappingController {
  constructor(private readonly ledger: CardLedgerService) {}

  @Get()
  @Header('cache-control', 'private, no-store')
  list(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
  ) {
    return this.ledger.listEdgeCardMappings(organizationId, branchId);
  }
}
