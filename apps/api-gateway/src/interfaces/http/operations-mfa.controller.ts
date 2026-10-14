import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { DomainError } from '@funtino/backend-core';
import { FUNTINO_STORE, type FuntinoStorePort } from '../../infrastructure/store/funtino-store.js';
import {
  IdentityAccessClient,
  type MfaProof,
} from '../../infrastructure/identity-access/identity-access.client.js';
import { CurrentUser, requestCorrelationId, success } from './current-user.decorator.js';
import type { AuthenticatedRequest } from './current-user.decorator.js';
import { SessionGuard } from './session.guard.js';
import { TrustedOriginGuard } from './trusted-origin.guard.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const totpSchema = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();
const proofSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('totp'), code: z.string().regex(/^\d{6}$/) }).strict(),
  z.object({ method: z.literal('recovery'), code: z.string().min(27).max(35) }).strict(),
]);

function bindMfaProofToSystemAdminSession<T extends { validUntil: string }>(
  result: T,
  session: { isSystemAdmin: boolean; expiresAt: number },
): T {
  return session.isSystemAdmin
    ? { ...result, validUntil: new Date(session.expiresAt).toISOString() }
    : result;
}

@Controller('api/v1/operations/mfa')
@UseGuards(SessionGuard)
export class OperationsMfaController {
  constructor(
    private readonly identityAccess: IdentityAccessClient,
    @Inject(FUNTINO_STORE) private readonly store: FuntinoStorePort,
  ) {}

  @Get('status')
  async status(
    @CurrentUser() user: { id: string },
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    this.preventCaching(reply);
    const session = this.requireSession(request);
    return success(
      await this.identityAccess.mfaStatus(user.id, session.id, requestCorrelationId(request)),
      request,
    );
  }

  @Post('enrollment/start')
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  async startEnrollment(
    @CurrentUser() user: { id: string },
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    this.preventCaching(reply);
    const session = this.requireSession(request);
    return success(
      await this.identityAccess.startMfaEnrollment(
        user.id,
        session.id,
        requestCorrelationId(request),
      ),
      request,
    );
  }

  @Post('enrollment/confirm')
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  async confirmEnrollment(
    @CurrentUser() user: { id: string },
    @Body(new ZodValidationPipe(totpSchema)) body: { code: string },
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    this.preventCaching(reply);
    const session = this.requireSession(request);
    const result = await this.identityAccess.confirmMfaEnrollment(
      user.id,
      session.id,
      requestCorrelationId(request),
      body.code,
    );
    const sessionBoundResult = bindMfaProofToSystemAdminSession(
      result,
      await this.systemAdminProofPolicy(user.id, session),
    );
    await this.store.updateSessionMfa(session.id, sessionBoundResult);
    return success(sessionBoundResult, request);
  }

  @Post('step-up/verify')
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  async verifyStepUp(
    @CurrentUser() user: { id: string },
    @Body(new ZodValidationPipe(proofSchema)) body: MfaProof,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    this.preventCaching(reply);
    const session = this.requireSession(request);
    const result = await this.identityAccess.verifyMfaStepUp(
      user.id,
      session.id,
      requestCorrelationId(request),
      body,
    );
    const sessionBoundResult = bindMfaProofToSystemAdminSession(
      result,
      await this.systemAdminProofPolicy(user.id, session),
    );
    await this.store.updateSessionMfa(session.id, sessionBoundResult);
    return success(sessionBoundResult, request);
  }

  @Post('recovery-codes/regenerate')
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  async regenerateRecoveryCodes(
    @CurrentUser() user: { id: string },
    @Body(new ZodValidationPipe(proofSchema)) body: MfaProof,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    this.preventCaching(reply);
    const session = this.requireSession(request);
    const result = await this.identityAccess.regenerateMfaRecoveryCodes(
      user.id,
      session.id,
      requestCorrelationId(request),
      body,
    );
    const sessionBoundResult = bindMfaProofToSystemAdminSession(
      result,
      await this.systemAdminProofPolicy(user.id, session),
    );
    await this.store.updateSessionMfa(session.id, sessionBoundResult);
    return success(sessionBoundResult, request);
  }

  @Post('disable')
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  async disable(
    @CurrentUser() user: { id: string },
    @Body(new ZodValidationPipe(proofSchema)) body: MfaProof,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    this.preventCaching(reply);
    const session = this.requireSession(request);
    if (await this.isGlobalSystemAdmin(user.id, requestCorrelationId(request))) {
      throw new DomainError(
        'FORBIDDEN',
        'عامل MFA مدیر سراسری برای step-up فرمان‌های پرریسک نگه داشته می‌شود.',
      );
    }
    const result = await this.identityAccess.disableMfa(
      user.id,
      session.id,
      requestCorrelationId(request),
      body,
    );
    await this.store.clearSessionMfa(session.id);
    return success(result, request);
  }

  private requireSession(request: AuthenticatedRequest) {
    if (!request.session) throw new DomainError('UNAUTHENTICATED', 'نشست معتبر نیست.');
    return request.session;
  }

  private async systemAdminProofPolicy(
    userId: string,
    session: { expiresAt: number },
  ): Promise<{ isSystemAdmin: boolean; expiresAt: number }> {
    return {
      isSystemAdmin: await this.isGlobalSystemAdmin(userId),
      expiresAt: session.expiresAt,
    };
  }

  private async isGlobalSystemAdmin(userId: string, correlationId?: string): Promise<boolean> {
    const access = await this.identityAccess.currentAccessContext(
      userId,
      correlationId ?? randomUUID(),
    );
    return access.memberships.some(
      (membership) =>
        membership.status === 'active' &&
        membership.role.status === 'active' &&
        membership.role.name === 'system_admin' &&
        membership.scope.type === 'global',
    );
  }

  private preventCaching(reply: FastifyReply): void {
    reply.header('cache-control', 'no-store, private');
    reply.header('pragma', 'no-cache');
  }
}
