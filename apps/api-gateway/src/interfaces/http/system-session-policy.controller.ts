import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { DomainError } from '@funtino/backend-core';
import { z } from 'zod';
import { IdentityAccessClient } from '../../infrastructure/identity-access/identity-access.client.js';
import { CurrentUser, requestCorrelationId, success } from './current-user.decorator.js';
import type { AuthenticatedRequest } from './current-user.decorator.js';
import { SessionGuard } from './session.guard.js';
import { TrustedOriginGuard } from './trusted-origin.guard.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const updatePolicySchema = z
  .object({
    managementSessionTtlHours: z.number().int().min(1).max(12),
    reason: z.string().trim().min(8).max(500),
  })
  .strict();

@Controller('api/v1/system/security/session-policy')
@UseGuards(SessionGuard)
export class SystemSessionPolicyController {
  constructor(private readonly identityAccess: IdentityAccessClient) {}

  @Get()
  @Header('cache-control', 'no-store, private')
  @Header('pragma', 'no-cache')
  async getPolicy(@CurrentUser() user: { id: string }, @Req() request: AuthenticatedRequest) {
    const session = this.session(request);
    const correlationId = requestCorrelationId(request);
    await this.authorize(user.id, session, correlationId);
    return success(
      await this.identityAccess.managementSessionPolicy(user.id, session, correlationId),
      request,
    );
  }

  @Put()
  @UseGuards(TrustedOriginGuard)
  @Header('cache-control', 'no-store, private')
  @Header('pragma', 'no-cache')
  async updatePolicy(
    @CurrentUser() user: { id: string },
    @Body(new ZodValidationPipe(updatePolicySchema)) body: z.infer<typeof updatePolicySchema>,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const session = this.session(request);
    const correlationId = requestCorrelationId(request);
    await this.authorize(user.id, session, correlationId);
    const result = await this.identityAccess.updateManagementSessionPolicy(
      user.id,
      session,
      body.managementSessionTtlHours,
      body.reason,
      this.expectedVersion(ifMatch),
      correlationId,
      this.idempotencyKey(idempotencyKey),
    );
    return success({ ...result.data, policyVersion: result.policyVersion }, request);
  }

  private async authorize(
    userId: string,
    session: NonNullable<AuthenticatedRequest['session']>,
    correlationId: string,
  ) {
    const decision = await this.identityAccess.evaluateAuthorization(
      userId,
      session,
      { permission: 'system.session_policy.manage', scope: { type: 'global' } },
      correlationId,
    );
    if (!decision.allowed) {
      throw new DomainError('FORBIDDEN', 'مجوز مدیریت تنظیم نشست سراسری را ندارید.');
    }
  }

  private session(request: AuthenticatedRequest) {
    if (!request.session) throw new DomainError('UNAUTHENTICATED', 'نشست معتبر نیست.');
    return request.session;
  }

  private idempotencyKey(value: string | undefined): string {
    if (!value || value.length < 16 || value.length > 128) {
      throw new BadRequestException('A valid Idempotency-Key is required.');
    }
    return value;
  }

  private expectedVersion(value: string | undefined): number {
    const match = /^"([1-9][0-9]*)"$/.exec(value ?? '');
    const version = match ? Number(match[1]) : Number.NaN;
    if (!Number.isSafeInteger(version)) {
      throw new BadRequestException('A quoted If-Match version is required.');
    }
    return version;
  }
}
