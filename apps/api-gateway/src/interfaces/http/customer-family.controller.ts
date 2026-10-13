import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { DomainError } from '@funtino/backend-core';
import { z } from 'zod';
import { CustomerFamilyService } from '../../application/customer/customer-family.service.js';
import { CurrentUser, requestCorrelationId, success } from './current-user.decorator.js';
import type { AuthenticatedRequest } from './current-user.decorator.js';
import { SessionGuard } from './session.guard.js';
import { TrustedOriginGuard } from './trusted-origin.guard.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const uuid = z.string().uuid();
const addFamilyMemberSchema = z
  .object({
    displayName: z.string().trim().min(2).max(80),
    relativeMemberId: z
      .union([uuid, z.literal('viewer')])
      .nullable()
      .optional(),
    relationship: z.enum(['parent', 'child', 'spouse', 'sibling', 'guardian', 'ward']),
    basis: z.enum(['biological', 'legal', 'adoptive', 'step', 'partner', 'unspecified']),
    displayGender: z.enum(['female', 'male', 'unspecified']).optional(),
    birthDate: z.string().date().nullable().optional(),
    isDependent: z.boolean(),
    phone: z.string().trim().min(8).max(20).optional(),
    createClaimLink: z.boolean().optional(),
  })
  .strict();
const updateFamilyMemberSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    displayName: z.string().trim().min(2).max(80).optional(),
    displayGender: z.enum(['female', 'male', 'unspecified']).nullable().optional(),
    birthDate: z.string().date().nullable().optional(),
    relationshipId: uuid.optional(),
    relativeMemberId: uuid.optional(),
    relationship: z.enum(['parent', 'child', 'spouse', 'sibling', 'guardian', 'ward']).optional(),
    basis: z.enum(['biological', 'legal', 'adoptive', 'step', 'partner', 'unspecified']).optional(),
  })
  .strict()
  .refine((value) => {
    const hasRelationshipField =
      value.relationshipId !== undefined ||
      value.relativeMemberId !== undefined ||
      value.relationship !== undefined ||
      value.basis !== undefined;
    return (
      !hasRelationshipField || Boolean(value.relativeMemberId && value.relationship && value.basis)
    );
  })
  .refine(
    (value) =>
      value.displayName !== undefined ||
      value.displayGender !== undefined ||
      value.birthDate !== undefined ||
      value.relativeMemberId !== undefined,
  );
const archiveMemberSchema = z.object({ expectedVersion: z.number().int().positive() }).strict();
const removeRelationshipSchema = z
  .object({ memberId: uuid, expectedVersion: z.number().int().positive() })
  .strict();
const previewSchema = z.object({ token: z.string().min(40).max(128) }).strict();
const acceptSchema = z
  .object({ token: z.string().min(40).max(128).optional(), invitationId: uuid.optional() })
  .strict()
  .refine((value) => Boolean(value.token) !== Boolean(value.invitationId));

@Controller('api/v1/customer/family')
export class CustomerFamilyController {
  constructor(private readonly family: CustomerFamilyService) {}

  @Get()
  @UseGuards(SessionGuard)
  @Header('cache-control', 'private, no-store')
  @Header('pragma', 'no-cache')
  async list(@CurrentUser() user: { id: string }, @Req() request: AuthenticatedRequest) {
    return success(await this.family.listForUser(user.id), request);
  }

  @Post('households/:householdId/members')
  @UseGuards(SessionGuard, TrustedOriginGuard)
  @HttpCode(HttpStatus.CREATED)
  @Header('cache-control', 'private, no-store')
  async addMember(
    @CurrentUser() user: { id: string },
    @Param('householdId', new ParseUUIDPipe()) householdId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(addFamilyMemberSchema)) body: z.infer<typeof addFamilyMemberSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    return success(
      await this.family.addMember(user.id, householdId, body, {
        correlationId: requestCorrelationId(request),
        idempotencyKey: this.requireIdempotencyKey(idempotencyKey),
      }),
      request,
    );
  }

  @Patch('households/:householdId/members/:memberId')
  @UseGuards(SessionGuard, TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  @Header('cache-control', 'private, no-store')
  async updateMember(
    @CurrentUser() user: { id: string },
    @Param('householdId', new ParseUUIDPipe()) householdId: string,
    @Param('memberId', new ParseUUIDPipe()) memberId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(updateFamilyMemberSchema))
    body: z.infer<typeof updateFamilyMemberSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    return success(
      await this.family.updateMember(user.id, householdId, memberId, body, {
        correlationId: requestCorrelationId(request),
        idempotencyKey: this.requireIdempotencyKey(idempotencyKey),
      }),
      request,
    );
  }

  @Post('households/:householdId/members/:memberId/archive')
  @UseGuards(SessionGuard, TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  @Header('cache-control', 'private, no-store')
  async archiveMember(
    @CurrentUser() user: { id: string },
    @Param('householdId', new ParseUUIDPipe()) householdId: string,
    @Param('memberId', new ParseUUIDPipe()) memberId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(archiveMemberSchema)) body: z.infer<typeof archiveMemberSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    return success(
      await this.family.archiveMember(user.id, householdId, memberId, body.expectedVersion, {
        correlationId: requestCorrelationId(request),
        idempotencyKey: this.requireIdempotencyKey(idempotencyKey),
      }),
      request,
    );
  }

  @Post('households/:householdId/relationships/:relationshipId/remove')
  @UseGuards(SessionGuard, TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  @Header('cache-control', 'private, no-store')
  async removeRelationship(
    @CurrentUser() user: { id: string },
    @Param('householdId', new ParseUUIDPipe()) householdId: string,
    @Param('relationshipId', new ParseUUIDPipe()) relationshipId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(removeRelationshipSchema))
    body: z.infer<typeof removeRelationshipSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    return success(
      await this.family.removeRelationship(user.id, householdId, relationshipId, body, {
        correlationId: requestCorrelationId(request),
        idempotencyKey: this.requireIdempotencyKey(idempotencyKey),
      }),
      request,
    );
  }

  @Post('invitations/preview')
  @HttpCode(HttpStatus.OK)
  @Header('cache-control', 'private, no-store')
  @Header('pragma', 'no-cache')
  @Header('referrer-policy', 'no-referrer')
  async preview(
    @Body(new ZodValidationPipe(previewSchema)) body: z.infer<typeof previewSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    return success(await this.family.previewInvitation(body.token), request);
  }

  @Post('invitations/accept')
  @UseGuards(SessionGuard, TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  @Header('cache-control', 'private, no-store')
  async accept(
    @CurrentUser() user: { id: string },
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(acceptSchema)) body: z.infer<typeof acceptSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    return success(
      await this.family.acceptInvitation(user.id, body, {
        correlationId: requestCorrelationId(request),
        idempotencyKey: this.requireIdempotencyKey(idempotencyKey),
      }),
      request,
    );
  }

  @Post('invitations/:invitationId/link')
  @UseGuards(SessionGuard, TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  @Header('cache-control', 'private, no-store')
  async link(
    @CurrentUser() user: { id: string },
    @Param('invitationId', new ParseUUIDPipe()) invitationId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return success(
      await this.family.linkInvitation(user.id, invitationId, {
        correlationId: requestCorrelationId(request),
        idempotencyKey: this.requireIdempotencyKey(idempotencyKey),
      }),
      request,
    );
  }

  @Post('invitations/:invitationId/approve-claim')
  @UseGuards(SessionGuard, TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  @Header('cache-control', 'private, no-store')
  async approveClaim(
    @CurrentUser() user: { id: string },
    @Param('invitationId', new ParseUUIDPipe()) invitationId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return success(
      await this.family.approveDependentClaim(user.id, invitationId, {
        correlationId: requestCorrelationId(request),
        idempotencyKey: this.requireIdempotencyKey(idempotencyKey),
      }),
      request,
    );
  }

  @Post('invitations/:invitationId/decline')
  @UseGuards(SessionGuard, TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  @Header('cache-control', 'private, no-store')
  async decline(
    @CurrentUser() user: { id: string },
    @Param('invitationId', new ParseUUIDPipe()) invitationId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return success(
      await this.family.declineInvitation(user.id, invitationId, {
        correlationId: requestCorrelationId(request),
        idempotencyKey: this.requireIdempotencyKey(idempotencyKey),
      }),
      request,
    );
  }

  @Post('invitations/:invitationId/revoke')
  @UseGuards(SessionGuard, TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  @Header('cache-control', 'private, no-store')
  async revoke(
    @CurrentUser() user: { id: string },
    @Param('invitationId', new ParseUUIDPipe()) invitationId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return success(
      await this.family.revokeInvitation(user.id, invitationId, {
        correlationId: requestCorrelationId(request),
        idempotencyKey: this.requireIdempotencyKey(idempotencyKey),
      }),
      request,
    );
  }

  private requireIdempotencyKey(value?: string): string {
    const parsed = uuid.safeParse(value);
    if (!parsed.success)
      throw new DomainError('VALIDATION_ERROR', 'کلید جلوگیری از ثبت تکراری معتبر نیست.');
    return parsed.data;
  }
}
