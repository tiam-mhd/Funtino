import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import type { FastifyReply } from 'fastify';
import { DomainError } from '@funtino/backend-core';
import {
  AuthService,
  MANAGEMENT_LOGIN_CHALLENGE_COOKIE,
  MANAGEMENT_SESSION_COOKIE,
  SESSION_COOKIE,
} from '../../application/auth/auth.service.js';
import { CurrentUser, requestCorrelationId, success } from './current-user.decorator.js';
import type { AuthenticatedRequest } from './current-user.decorator.js';
import { SessionGuard } from './session.guard.js';
import { TrustedOriginGuard } from './trusted-origin.guard.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';
import { sessionCookieOptions } from '../../application/auth/session-policy.js';

const requestOtpSchema = z.object({ phone: z.string().min(8).max(20) }).strict();
const verifyOtpSchema = z
  .object({
    challengeId: z.string().uuid(),
    phone: z.string().min(8).max(20),
    code: z.string().regex(/^\d{6}$/),
  })
  .strict();
const passwordVerifySchema = z.object({ password: z.string().min(1).max(128) }).strict();
const passwordChangeSchema = z
  .object({
    enabled: z.boolean(),
    challengeId: z.string().uuid(),
    code: z.string().regex(/^\d{6}$/),
    password: z.string().min(12).max(128).optional(),
    currentPassword: z.string().min(1).max(128).optional(),
  })
  .strict();

type RequestOtpBody = z.infer<typeof requestOtpSchema>;
type VerifyOtpBody = z.infer<typeof verifyOtpSchema>;

@Controller('api/v1/auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  async requestOtp(
    @Body(new ZodValidationPipe(requestOtpSchema)) body: RequestOtpBody,
    @Req() request: AuthenticatedRequest,
  ) {
    return success(await this.authService.requestOtp(body.phone), request);
  }

  @Post('otp/verify')
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  async verifyOtp(
    @Body(new ZodValidationPipe(verifyOtpSchema)) body: VerifyOtpBody,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.authService.verifyOtp({
      ...body,
      correlationId: requestCorrelationId(request),
    });
    reply.setCookie(
      SESSION_COOKIE,
      result.token,
      sessionCookieOptions(process.env, result.expiresAt),
    );
    return success({ user: result.user, expiresAt: result.expiresAt }, request);
  }

  @Post('management/otp/request')
  @HttpCode(HttpStatus.OK)
  async requestManagementOtp(
    @Body(new ZodValidationPipe(requestOtpSchema)) body: RequestOtpBody,
    @Req() request: AuthenticatedRequest,
  ) {
    return success(await this.authService.requestOtp(body.phone, 'management_login'), request);
  }

  @Post('management/otp/verify')
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  async verifyManagementOtp(
    @Body(new ZodValidationPipe(verifyOtpSchema)) body: VerifyOtpBody,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.authService.verifyManagementOtp({
      ...body,
      correlationId: requestCorrelationId(request),
    });
    if (result.requiresPassword && result.challengeToken) {
      reply.setCookie(
        MANAGEMENT_LOGIN_CHALLENGE_COOKIE,
        result.challengeToken,
        managementChallengeCookieOptions(process.env, result.expiresAt),
      );
    } else if (result.token) {
      reply.setCookie(
        MANAGEMENT_SESSION_COOKIE,
        result.token,
        sessionCookieOptions(process.env, result.expiresAt),
      );
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      clearManagementChallenge(reply);
    }
    return success(
      { requiresPassword: result.requiresPassword, expiresAt: result.expiresAt },
      request,
    );
  }

  @Post('management/password/verify')
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  async verifyManagementPassword(
    @Body(new ZodValidationPipe(passwordVerifySchema)) body: z.infer<typeof passwordVerifySchema>,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const challengeToken = request.cookies?.[MANAGEMENT_LOGIN_CHALLENGE_COOKIE];
    if (!challengeToken) {
      clearManagementChallenge(reply);
      throw new DomainError(
        'UNAUTHENTICATED',
        'درخواست ورود معتبر نیست یا مهلت آن پایان یافته است.',
      );
    }
    const result = await this.authService.verifyManagementPassword({
      challengeToken,
      password: body.password,
      correlationId: requestCorrelationId(request),
    });
    reply.setCookie(
      MANAGEMENT_SESSION_COOKIE,
      result.token,
      sessionCookieOptions(process.env, result.expiresAt),
    );
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    clearManagementChallenge(reply);
    return success({ expiresAt: result.expiresAt }, request);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    await this.authService.logout(request.cookies?.[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return success({ loggedOut: true }, request);
  }

  @Post('management/logout')
  @UseGuards(SessionGuard, TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  async managementLogout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    await this.authService.logout(request.cookies?.[MANAGEMENT_SESSION_COOKIE]);
    reply.clearCookie(MANAGEMENT_SESSION_COOKIE, { path: '/' });
    clearManagementChallenge(reply);
    return success({ loggedOut: true }, request);
  }

  @Get('me')
  @UseGuards(SessionGuard)
  async me(@CurrentUser() user: { id: string }, @Req() request: AuthenticatedRequest) {
    return success(await this.authService.getMe(user.id), request);
  }

  @Get('management/me')
  @UseGuards(SessionGuard)
  async managementMe(@CurrentUser() user: { id: string }, @Req() request: AuthenticatedRequest) {
    return success(await this.authService.getMe(user.id), request);
  }

  @Get('management/password')
  @UseGuards(SessionGuard)
  async managementPasswordStatus(
    @CurrentUser() user: { id: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return success(await this.authService.getManagementPasswordStatus(user.id), request);
  }

  @Post('management/password/otp/request')
  @UseGuards(SessionGuard, TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  async requestManagementPasswordOtp(
    @CurrentUser() user: { id: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return success(await this.authService.requestManagementPasswordOtp(user.id), request);
  }

  @Put('management/password')
  @UseGuards(SessionGuard, TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  async updateManagementPassword(
    @CurrentUser() user: { id: string },
    @Body(new ZodValidationPipe(passwordChangeSchema)) body: z.infer<typeof passwordChangeSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!request.session) throw new DomainError('UNAUTHENTICATED', 'نشست معتبر نیست.');
    return success(
      await this.authService.updateManagementPassword({
        ...body,
        userId: user.id,
        sessionId: request.session.id,
        correlationId: requestCorrelationId(request),
      }),
      request,
    );
  }
}

function managementChallengeCookieOptions(environment: NodeJS.ProcessEnv, expiresAt: string) {
  const options = sessionCookieOptions(environment, expiresAt);
  return { ...options, path: '/api/v1/auth/management/password/verify' };
}

function clearManagementChallenge(reply: FastifyReply): void {
  reply.clearCookie(MANAGEMENT_LOGIN_CHALLENGE_COOKIE, {
    path: '/api/v1/auth/management/password/verify',
    ...(process.env.SESSION_COOKIE_DOMAIN ? { domain: process.env.SESSION_COOKIE_DOMAIN } : {}),
  });
}
