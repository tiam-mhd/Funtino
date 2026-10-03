import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import type { FastifyReply } from 'fastify';
import { DomainError } from '@funtino/backend-core';
import { CustomerService } from '../../application/customer/customer.service.js';
import { CurrentUser, requestCorrelationId, success } from './current-user.decorator.js';
import type { AuthenticatedRequest } from './current-user.decorator.js';
import { SessionGuard } from './session.guard.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const householdSchema = z.object({ name: z.string().min(2).max(80) });
const memberSchema = z.object({
  displayName: z.string().min(2).max(80),
  relationship: z.string().min(2).max(40),
  birthDate: z.string().date().nullable().optional(),
  isDependent: z.boolean().optional(),
});
const cardLinkSchema = z.object({
  householdId: z.string().uuid(),
  memberId: z.string().uuid().nullable().optional(),
  branchId: z.string().uuid(),
  externalCardId: z.string().min(4).max(80),
});
const profileSchema = z.object({
  firstName: z.string().trim().min(2).max(60).nullable().optional(),
  lastName: z.string().trim().min(2).max(60).nullable().optional(),
  email: z.string().trim().email().max(160).nullable().optional(),
  birthDate: z.string().date().nullable().optional(),
  gender: z.enum(['female', 'male', 'other', 'prefer_not_to_say']).nullable().optional(),
  city: z.string().trim().min(2).max(80).nullable().optional(),
  avatarPreset: z
    .enum(['sun', 'star', 'rainbow', 'rocket', 'crown', 'bear', 'cat', 'fox'])
    .nullable()
    .optional(),
});
const claimSchema = z.object({ householdId: z.string().uuid() });
const branchQuerySchema = z.object({ branchId: z.string().uuid().optional() });
type HouseholdBody = z.infer<typeof householdSchema>;
type MemberBody = z.infer<typeof memberSchema>;
type CardLinkBody = z.infer<typeof cardLinkSchema>;
type ProfileBody = z.infer<typeof profileSchema>;
type ClaimBody = z.infer<typeof claimSchema>;
type BranchQuery = z.infer<typeof branchQuerySchema>;

@Controller('api/v1/customer')
export class CustomerController {
  constructor(@Inject(CustomerService) private readonly customerService: CustomerService) {}

  @Get('branches')
  async listBranches(@Req() request: AuthenticatedRequest) {
    return success(await this.customerService.listBranches(), request);
  }

  @Get('branches/:branchId')
  async getBranch(@Param('branchId') branchId: string, @Req() request: AuthenticatedRequest) {
    return success(await this.customerService.getBranch(branchId), request);
  }

  @Get('home')
  @UseGuards(SessionGuard)
  async home(
    @CurrentUser() user: { id: string },
    @Query(new ZodValidationPipe(branchQuerySchema)) query: BranchQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return success(await this.customerService.getHome(user.id, query.branchId), request);
  }

  @Get('profile')
  @UseGuards(SessionGuard)
  async profile(@CurrentUser() user: { id: string }, @Req() request: AuthenticatedRequest) {
    return success(await this.customerService.getProfile(user.id), request);
  }

  @Patch('profile')
  @UseGuards(SessionGuard)
  async updateProfile(
    @CurrentUser() user: { id: string },
    @Body(new ZodValidationPipe(profileSchema)) body: ProfileBody,
    @Req() request: AuthenticatedRequest,
  ) {
    return success(
      await this.customerService.updateProfile(user.id, body, requestCorrelationId(request)),
      request,
    );
  }

  @Post('profile/avatar')
  @UseGuards(SessionGuard)
  @HttpCode(HttpStatus.OK)
  async uploadAvatar(@CurrentUser() user: { id: string }, @Req() request: MultipartRequest) {
    const file = await request.file();
    if (!file) throw new DomainError('VALIDATION_ERROR', 'تصویر پروفایل الزامی است.');
    const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (!allowedMimeTypes.has(file.mimetype)) {
      throw new DomainError('VALIDATION_ERROR', 'فرمت تصویر باید JPEG، PNG یا WebP باشد.');
    }
    const data = await file.toBuffer();
    if (data.length > 2_000_000) {
      throw new DomainError('VALIDATION_ERROR', 'حجم تصویر پروفایل باید کمتر از ۲ مگابایت باشد.');
    }
    return success(
      await this.customerService.saveAvatar(
        user.id,
        { mimeType: file.mimetype, data },
        requestCorrelationId(request),
      ),
      request,
    );
  }

  @Get('profile/avatar')
  @UseGuards(SessionGuard)
  async avatar(@CurrentUser() user: { id: string }, @Res() reply: FastifyReply) {
    const avatar = await this.customerService.getAvatar(user.id);
    return reply
      .header('cache-control', 'private, max-age=300')
      .type(avatar.mimeType)
      .send(avatar.data);
  }

  @Get('households')
  @UseGuards(SessionGuard)
  async households(@CurrentUser() user: { id: string }, @Req() request: AuthenticatedRequest) {
    return success(await this.customerService.listHouseholds(user.id), request);
  }

  @Post('households')
  @UseGuards(SessionGuard)
  async createHousehold(
    @CurrentUser() user: { id: string },
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(householdSchema)) body: HouseholdBody,
    @Req() request: AuthenticatedRequest,
  ) {
    return success(
      await this.customerService.createHousehold(
        user.id,
        body.name,
        requestCorrelationId(request),
        this.requireIdempotencyKey(idempotencyKey),
      ),
      request,
    );
  }

  @Post('households/:householdId/members')
  @UseGuards(SessionGuard)
  async addMember(
    @CurrentUser() user: { id: string },
    @Param('householdId') householdId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(memberSchema)) body: MemberBody,
    @Req() request: AuthenticatedRequest,
  ) {
    return success(
      await this.customerService.addMember(
        user.id,
        householdId,
        body,
        requestCorrelationId(request),
        this.requireIdempotencyKey(idempotencyKey),
      ),
      request,
    );
  }

  @Get('cards')
  @UseGuards(SessionGuard)
  async cards(@CurrentUser() user: { id: string }, @Req() request: AuthenticatedRequest) {
    return success(await this.customerService.listCards(user.id), request);
  }

  @Post('cards/link')
  @UseGuards(SessionGuard)
  @HttpCode(HttpStatus.OK)
  async linkCard(
    @CurrentUser() user: { id: string },
    @Body(new ZodValidationPipe(cardLinkSchema)) body: CardLinkBody,
    @Req() request: AuthenticatedRequest,
  ) {
    return success(
      await this.customerService.linkCard(user.id, body, requestCorrelationId(request)),
      request,
    );
  }

  @Get('wallets/:walletId/summary')
  @UseGuards(SessionGuard)
  async walletSummary(
    @CurrentUser() user: { id: string },
    @Param('walletId') walletId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return success(await this.customerService.walletSummary(user.id, walletId), request);
  }

  @Get('wallets/:walletId/transactions')
  @UseGuards(SessionGuard)
  async walletTransactions(
    @CurrentUser() user: { id: string },
    @Param('walletId') walletId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return success(await this.customerService.walletTransactions(user.id, walletId), request);
  }

  @Get('missions')
  @UseGuards(SessionGuard)
  async missions(
    @CurrentUser() user: { id: string },
    @Query(new ZodValidationPipe(branchQuerySchema)) query: BranchQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return success(await this.customerService.listMissions(user.id, query.branchId), request);
  }

  @Post('missions/:missionId/claim')
  @UseGuards(SessionGuard)
  @HttpCode(HttpStatus.OK)
  async claimMission(
    @CurrentUser() user: { id: string },
    @Param('missionId') missionId: string,
    @Body(new ZodValidationPipe(claimSchema)) body: ClaimBody,
    @Req() request: AuthenticatedRequest,
  ) {
    return success(
      await this.customerService.claimMission(
        user.id,
        missionId,
        body.householdId,
        requestCorrelationId(request),
      ),
      request,
    );
  }

  private requireIdempotencyKey(value?: string): string {
    const parsed = z.string().uuid().safeParse(value);
    if (!parsed.success)
      throw new DomainError('VALIDATION_ERROR', 'کلید جلوگیری از ثبت تکراری معتبر نیست.');
    return parsed.data;
  }
}

type MultipartRequest = AuthenticatedRequest & {
  file: () => Promise<
    | {
        mimetype: string;
        toBuffer: () => Promise<Buffer>;
      }
    | undefined
  >;
};
