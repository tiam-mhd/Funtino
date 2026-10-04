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
import { z } from 'zod';
import type { FastifyReply } from 'fastify';
import { AuthService, SESSION_COOKIE } from '../../application/auth/auth.service.js';
import { CurrentUser, requestCorrelationId, success } from './current-user.decorator.js';
import type { AuthenticatedRequest } from './current-user.decorator.js';
import { SessionGuard } from './session.guard.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';
import { sessionCookieOptions } from '../../application/auth/session-policy.js';

const requestOtpSchema = z.object({ phone: z.string().min(8).max(20) });
const verifyOtpSchema = z.object({
  challengeId: z.string().uuid(),
  phone: z.string().min(8).max(20),
  code: z.string().regex(/^\d{6}$/),
});

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
    return success(
      { user: result.user, expiresAt: result.expiresAt, mfaRequired: result.mfaRequired },
      request,
    );
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

  @Get('me')
  @UseGuards(SessionGuard)
  async me(@CurrentUser() user: { id: string }, @Req() request: AuthenticatedRequest) {
    return success(await this.authService.getMe(user.id), request);
  }
}
