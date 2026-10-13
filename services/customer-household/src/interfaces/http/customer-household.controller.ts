import {
  BadRequestException,
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
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import {
  CustomerHouseholdService,
  type HouseholdCommandMeta,
  type UpdateFamilyMemberInput,
} from '../../application/customer-household.service.js';
import { CustomerHouseholdServiceTokenGuard } from './service-token.guard.js';

const uuid = z.string().uuid();
const createHouseholdSchema = z
  .object({
    ownerUserId: uuid,
    name: z.string().trim().min(2).max(80),
  })
  .strict();
const addMemberSchema = z
  .object({
    displayName: z.string().trim().min(2).max(80),
    relationship: z.string().trim().min(2).max(40),
    birthDate: z.string().date().nullable().optional(),
    isDependent: z.boolean().optional(),
  })
  .strict();
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
    targetUserId: uuid.optional(),
    targetPhoneHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/iu)
      .optional(),
    createClaimLink: z.boolean().optional(),
  })
  .strict()
  .refine((value) => !(value.targetUserId && value.targetPhoneHash));
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
const archiveFamilyMemberSchema = z
  .object({ expectedVersion: z.number().int().positive() })
  .strict();
const removeFamilyRelationshipSchema = z
  .object({ memberId: uuid, expectedVersion: z.number().int().positive() })
  .strict();
const familyListSchema = z
  .object({
    targetPhoneHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/iu)
      .optional(),
  })
  .strict();
const invitationPreviewSchema = z.object({ token: z.string().min(40).max(128) }).strict();
const invitationAcceptSchema = z
  .object({
    token: z.string().min(40).max(128).optional(),
    invitationId: uuid.optional(),
    verifiedPhoneHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/iu)
      .optional(),
  })
  .strict()
  .refine((value) => Boolean(value.token) !== Boolean(value.invitationId));
const invitationDeclineSchema = z
  .object({
    verifiedPhoneHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/iu)
      .optional(),
  })
  .strict();

@Controller('internal/v1')
@UseGuards(CustomerHouseholdServiceTokenGuard)
export class CustomerHouseholdController {
  constructor(private readonly service: CustomerHouseholdService) {}

  @Get('users/:userId/households')
  @Header('cache-control', 'private, no-store')
  @Header('pragma', 'no-cache')
  listForUser(@Param('userId', new ParseUUIDPipe()) userId: string) {
    return this.service.listHouseholdsForUser(userId);
  }

  @Post('users/:userId/family')
  @HttpCode(HttpStatus.OK)
  @Header('cache-control', 'private, no-store')
  @Header('pragma', 'no-cache')
  listFamilyForUser(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Headers('x-funtino-actor-user-id') actorUserId: string | undefined,
    @Body() rawBody: unknown,
  ) {
    if (actorUserId?.toLowerCase() !== userId.toLowerCase()) {
      throw new BadRequestException('Actor does not match the requested customer.');
    }
    const parsed = familyListSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException('Family request is invalid.');
    return this.service.listFamilyForUser(userId, parsed.data.targetPhoneHash);
  }

  @Get('households/:householdId/validation')
  @Header('cache-control', 'private, no-store')
  validateForWallet(@Param('householdId', new ParseUUIDPipe()) householdId: string) {
    return this.service.validateHousehold(householdId);
  }

  @Get('households/:householdId/family-audit')
  @Header('cache-control', 'private, no-store')
  @Header('pragma', 'no-cache')
  listFamilyAuditHistory(
    @Param('householdId', new ParseUUIDPipe()) householdId: string,
    @Headers('x-funtino-actor-user-id') actorUserId: string | undefined,
  ) {
    if (!uuid.safeParse(actorUserId).success) {
      throw new BadRequestException('A valid actor is required.');
    }
    return this.service.listFamilyAuditHistory(householdId);
  }

  @Post('households')
  @HttpCode(201)
  create(
    @Body() rawBody: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const parsed = createHouseholdSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException('Household request is invalid.');
    return this.service.createHousehold(parsed.data, commandMeta(headers));
  }

  @Post('households/:householdId/members')
  @HttpCode(201)
  addMember(
    @Param('householdId', new ParseUUIDPipe()) householdId: string,
    @Body() rawBody: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const parsed = addMemberSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException('Household member request is invalid.');
    return this.service.addMember(householdId, parsed.data, commandMeta(headers));
  }

  @Post('households/:householdId/family-members')
  @HttpCode(201)
  addFamilyMember(
    @Param('householdId', new ParseUUIDPipe()) householdId: string,
    @Body() rawBody: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const parsed = addFamilyMemberSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException('Family member request is invalid.');
    return this.service.addFamilyMember(householdId, parsed.data, commandMeta(headers));
  }

  @Patch('households/:householdId/family-members/:memberId')
  @HttpCode(HttpStatus.OK)
  updateFamilyMember(
    @Param('householdId', new ParseUUIDPipe()) householdId: string,
    @Param('memberId', new ParseUUIDPipe()) memberId: string,
    @Body() rawBody: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const parsed = updateFamilyMemberSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException('Family member update is invalid.');
    return this.service.updateFamilyMember(
      householdId,
      memberId,
      parsed.data as UpdateFamilyMemberInput,
      commandMeta(headers),
    );
  }

  @Post('households/:householdId/family-members/:memberId/archive')
  @HttpCode(HttpStatus.OK)
  archiveFamilyMember(
    @Param('householdId', new ParseUUIDPipe()) householdId: string,
    @Param('memberId', new ParseUUIDPipe()) memberId: string,
    @Body() rawBody: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const parsed = archiveFamilyMemberSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException('Family member archive request is invalid.');
    return this.service.archiveFamilyMember(
      householdId,
      memberId,
      parsed.data.expectedVersion,
      commandMeta(headers),
    );
  }

  @Post('households/:householdId/family-relationships/:relationshipId/remove')
  @HttpCode(HttpStatus.OK)
  removeFamilyRelationship(
    @Param('householdId', new ParseUUIDPipe()) householdId: string,
    @Param('relationshipId', new ParseUUIDPipe()) relationshipId: string,
    @Body() rawBody: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const parsed = removeFamilyRelationshipSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException('Family relationship request is invalid.');
    return this.service.removeFamilyRelationship(
      householdId,
      relationshipId,
      parsed.data,
      commandMeta(headers),
    );
  }

  @Post('family-invitations/preview')
  @HttpCode(HttpStatus.OK)
  @Header('cache-control', 'private, no-store')
  @Header('pragma', 'no-cache')
  @Header('referrer-policy', 'no-referrer')
  previewInvitation(@Body() rawBody: unknown) {
    const parsed = invitationPreviewSchema.safeParse(rawBody);
    if (!parsed.success) return { valid: false };
    return this.service.previewInvitation(parsed.data.token);
  }

  @Post('family-invitations/accept')
  acceptInvitation(
    @Body() rawBody: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const parsed = invitationAcceptSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException('Invitation request is invalid.');
    return this.service.acceptInvitation(parsed.data, commandMeta(headers));
  }

  @Post('family-invitations/:invitationId/link')
  linkInvitation(
    @Param('invitationId', new ParseUUIDPipe()) invitationId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.service.linkAcceptedInvitation(invitationId, commandMeta(headers));
  }

  @Post('family-invitations/:invitationId/approve-claim')
  approveDependentClaim(
    @Param('invitationId', new ParseUUIDPipe()) invitationId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.service.approveDependentClaim(invitationId, commandMeta(headers));
  }

  @Post('family-invitations/:invitationId/decline')
  declineInvitation(
    @Param('invitationId', new ParseUUIDPipe()) invitationId: string,
    @Body() rawBody: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const parsed = invitationDeclineSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException('Invitation request is invalid.');
    return this.service.declineInvitation(
      invitationId,
      parsed.data.verifiedPhoneHash,
      commandMeta(headers),
    );
  }

  @Post('family-invitations/:invitationId/revoke')
  revokeInvitation(
    @Param('invitationId', new ParseUUIDPipe()) invitationId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.service.revokeInvitation(invitationId, commandMeta(headers));
  }
}

function commandMeta(headers: Record<string, string | string[] | undefined>): HouseholdCommandMeta {
  const single = (name: string): string | undefined => {
    const value = headers[name];
    return typeof value === 'string' ? value : undefined;
  };
  const actorUserId = uuid.safeParse(single('x-funtino-actor-user-id'));
  const correlationId = uuid.safeParse(single('x-correlation-id'));
  const idempotencyKey = uuid.safeParse(single('idempotency-key'));
  if (!actorUserId.success || !correlationId.success || !idempotencyKey.success) {
    throw new BadRequestException('Actor, correlation, and Idempotency-Key headers are required.');
  }
  return {
    actorUserId: actorUserId.data,
    correlationId: correlationId.data,
    idempotencyKey: idempotencyKey.data,
    callerService: 'api-gateway',
  };
}
