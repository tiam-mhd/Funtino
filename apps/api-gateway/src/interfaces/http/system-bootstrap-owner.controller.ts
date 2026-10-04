import {
  Controller,
  Get,
  Header,
  Inject,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { FUNTINO_STORE, type FuntinoStorePort } from '../../infrastructure/store/funtino-store.js';
import { normalizePhone } from '../../application/auth/auth.service.js';
import { IdentityAccessBootstrapLookupGuard } from './identity-access-bootstrap-lookup.guard.js';
import { success } from './current-user.decorator.js';

const OWNER_PHONE_ENV = 'SYSTEM_ADMIN_OWNER_PHONE_E164';
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

@Controller('internal/v1/system')
@UseGuards(IdentityAccessBootstrapLookupGuard)
export class SystemBootstrapOwnerController {
  constructor(@Inject(FUNTINO_STORE) private readonly store: FuntinoStorePort) {}

  @Get('bootstrap-owner')
  @Header('cache-control', 'no-store, private')
  async getConfiguredOwner(
    @Req() request: FastifyRequest & { requestId?: string; correlationId?: string },
  ) {
    const configuredPhone = process.env[OWNER_PHONE_ENV]?.trim();
    if (
      !configuredPhone ||
      !E164_PATTERN.test(configuredPhone) ||
      normalizePhone(configuredPhone) !== configuredPhone
    ) {
      throw new ServiceUnavailableException({
        status: 'error',
        error: {
          code: 'SYSTEM_ADMIN_OWNER_NOT_CONFIGURED',
          message: 'The system-owner phone is not configured in canonical E.164 format.',
        },
      });
    }

    const owner = await this.store.getUserByPhone(configuredPhone);
    if (!owner) {
      throw new ServiceUnavailableException({
        status: 'error',
        error: {
          code: 'SYSTEM_ADMIN_OWNER_ACCOUNT_NOT_FOUND',
          message: 'The configured system-owner account has not been registered.',
        },
      });
    }
    return success({ userId: owner.id }, request);
  }
}
