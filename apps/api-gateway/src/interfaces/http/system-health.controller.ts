import {
  Controller,
  Get,
  Header,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { DomainError } from '@funtino/backend-core';
import type { AuthenticatedRequest } from './current-user.decorator.js';
import { CurrentUser, requestCorrelationId, success } from './current-user.decorator.js';
import { SessionGuard } from './session.guard.js';
import { IdentityAccessClient } from '../../infrastructure/identity-access/identity-access.client.js';
import {
  PrometheusTelemetryClient,
  PrometheusTelemetryUnavailableError,
} from '../../infrastructure/observability/prometheus-telemetry.client.js';

@Controller('api/v1/system/health')
@UseGuards(SessionGuard)
export class SystemHealthController {
  constructor(
    private readonly identityAccess: IdentityAccessClient,
    private readonly telemetry: PrometheusTelemetryClient,
  ) {}

  @Get()
  @Header('cache-control', 'no-store, private')
  @Header('pragma', 'no-cache')
  async getSystemHealth(@CurrentUser() user: { id: string }, @Req() request: AuthenticatedRequest) {
    const session = request.session;
    if (!session) throw new DomainError('UNAUTHENTICATED', 'نشست معتبر نیست.');
    const correlationId = requestCorrelationId(request);
    const decision = await this.identityAccess.evaluateAuthorization(
      user.id,
      session,
      { permission: 'system.health.read', scope: { type: 'global' } },
      correlationId,
    );
    if (!decision.allowed) {
      throw new DomainError('FORBIDDEN', 'مجوز مشاهده‌ی سلامت سامانه وجود ندارد.');
    }

    try {
      return success(await this.telemetry.readSystemHealth(), request);
    } catch (error) {
      if (error instanceof PrometheusTelemetryUnavailableError) {
        throw new ServiceUnavailableException('داده‌ی پایش موقتاً در دسترس نیست.');
      }
      throw error;
    }
  }
}
