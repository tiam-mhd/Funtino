import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { normalizeCorrelationId } from '@funtino/backend-core';
import {
  edgeCardAssignmentRequestSchema,
  edgeCardAssignmentResultSchema,
  edgeCardBlockResultSchema,
  edgeCardCommandRequestSchema,
  edgeCardReplacementRequestResultSchema,
  edgeCustomerProfilePatchRequestSchema,
  edgeCustomerProfileSchema,
  edgeCustomerSearchPageSchema,
  edgeCustomerSearchQuerySchema,
  edgeHouseholdMemberCreateRequestSchema,
  edgeHouseholdMemberMutationResultSchema,
  edgeHouseholdMutationResultSchema,
  edgeHouseholdPatchRequestSchema,
  edgeHouseholdReadSchema,
  edgeProfileMutationResultSchema,
} from '@funtino/event-contracts';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DeviceRegistryService } from '../../application/device-registry.service.js';
import {
  DEVICE_SIGNATURE_VERIFIER,
  type DeviceSignatureVerifier,
} from '../../application/ports/device-signature-verifier.port.js';
import { EdgeOperatorTokenClient } from '../../infrastructure/identity-access/edge-operator-token.client.js';
import { EdgeProvisionalCustomerClient } from '../../infrastructure/customer-household/edge-provisional-customer.client.js';
import { EdgeHouseholdOperationsClient } from '../../infrastructure/customer-household/edge-household-operations.client.js';
import { WalletEdgeMappingClient } from '../../infrastructure/wallet/wallet-edge-mapping.client.js';
import { EdgeCardOperationsClient } from '../../infrastructure/wallet/edge-card-operations.client.js';
import { EdgeIdentityLookupClient } from '../../infrastructure/gateway/edge-identity-lookup.client.js';

const uuid = z.string().uuid();
const requestSchema = z.object({ provisionalId: uuid }).strict();
const householdQuerySchema = z.object({ branchId: uuid }).strict();

@Controller('internal/v2/edge')
export class EdgeCustomerOperationsController {
  constructor(
    private readonly registry: DeviceRegistryService,
    @Inject(DEVICE_SIGNATURE_VERIFIER) private readonly signatureVerifier: DeviceSignatureVerifier,
    private readonly operatorTokens: EdgeOperatorTokenClient,
    private readonly provisionalCustomers: EdgeProvisionalCustomerClient,
    private readonly householdOperations: EdgeHouseholdOperationsClient,
    private readonly walletMappings: WalletEdgeMappingClient,
    private readonly cardOperations: EdgeCardOperationsClient,
    private readonly identityLookup: EdgeIdentityLookupClient,
  ) {}

  @Post('customers/temporary')
  @HttpCode(HttpStatus.CREATED)
  async createTemporaryCustomer(
    @Body() rawBodyValue: unknown,
    @Headers('x-edge-installation-id') installationId: string | undefined,
    @Headers('x-edge-key-id') keyId: string | undefined,
    @Headers('x-edge-signature') signature: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const rawBody = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
    if (!rawBody) throw new ServiceUnavailableException('Raw Edge request body is unavailable.');
    if (!this.signatureVerifier.isEdgeConfigured())
      throw new ServiceUnavailableException('Edge authentication is not configured.');
    if (!this.signatureVerifier.verifyEdge(rawBody, keyId, signature))
      throw new UnauthorizedException('Edge signature is invalid.');
    if (!uuid.safeParse(installationId).success)
      throw new UnauthorizedException('Edge installation identity is invalid.');
    const parsed = requestSchema.safeParse(rawBodyValue);
    if (!parsed.success || !uuid.safeParse(idempotencyKey).success)
      throw new BadRequestException('Provisional customer request is invalid.');

    const installation = await this.registry.getEdgeInstallation(installationId!);
    if (
      !installation ||
      installation.status !== 'active' ||
      (installation.currentKeyId !== keyId && installation.previousKeyId !== keyId)
    ) {
      throw new UnauthorizedException('Edge installation is not authorized.');
    }
    if (!(await this.registry.consumeEdgeRequestQuota(installationId!))) {
      throw new HttpException('Edge request rate limit exceeded.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const token = parseBearerToken(authorization);
    const operator = await this.operatorTokens.validate(
      token,
      installation.branchId,
      'customer.provisional.create',
    );
    const record = await this.provisionalCustomers.create({
      provisionalId: parsed.data.provisionalId,
      sourceInstanceId: installation.sourceInstanceId,
      branchId: installation.branchId,
      actorUserId: operator.actorUserId,
      correlationId: normalizeCorrelationId(correlationId ?? request.id),
      idempotencyKey: idempotencyKey!,
    });
    return { ...record, customerConfirmed: false };
  }

  @Get('customers')
  async searchCustomers(
    @Query() rawQuery: unknown,
    @Headers('x-edge-installation-id') installationId: string | undefined,
    @Headers('x-edge-key-id') keyId: string | undefined,
    @Headers('x-edge-signature') signature: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const queryInput =
      rawQuery && typeof rawQuery === 'object' && !Array.isArray(rawQuery)
        ? {
            ...rawQuery,
            ...('pageSize' in rawQuery && typeof rawQuery.pageSize === 'string'
              ? { pageSize: Number(rawQuery.pageSize) }
              : {}),
          }
        : rawQuery;
    const query = edgeCustomerSearchQuerySchema.safeParse(queryInput);
    if (!query.success) throw new BadRequestException('Edge customer search query is invalid.');
    const context = await this.authorize({
      installationId,
      keyId,
      signature,
      authorization,
      request,
      branchId: query.data.branchId,
      permission: 'customer.lookup.limited',
    });
    const result = await this.householdOperations.search({
      sourceInstanceId: context.installation.sourceInstanceId,
      branchId: context.installation.branchId,
      actorUserId: context.operator.actorUserId,
      correlationId: normalizeCorrelationId(correlationId ?? request.id),
      query: query.data.query.trim(),
      cursor: query.data.cursor,
      pageSize: query.data.pageSize ?? 50,
    });
    const phones = await this.identityLookup.lookup(result.items.map((item) => item.customerId));
    return edgeCustomerSearchPageSchema.parse({
      ...result,
      items: result.items.map((item) => ({
        ...item,
        maskedPhone: phones.get(item.customerId.toLowerCase()) ?? null,
      })),
    });
  }

  @Get('customers/:customerId')
  async readCustomer(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Query() rawQuery: unknown,
    @Headers('x-edge-installation-id') installationId: string | undefined,
    @Headers('x-edge-key-id') keyId: string | undefined,
    @Headers('x-edge-signature') signature: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const query = householdQuerySchema.safeParse(rawQuery);
    if (!query.success) throw new BadRequestException('Edge customer query is invalid.');
    const context = await this.authorize({
      installationId,
      keyId,
      signature,
      authorization,
      request,
      branchId: query.data.branchId,
      permission: 'customer.lookup.limited',
    });
    const householdIds = await this.branchHouseholds(
      context.installation.organizationId,
      context.installation.branchId,
    );
    const [profile, phones] = await Promise.all([
      this.householdOperations.readCustomer({
        sourceInstanceId: context.installation.sourceInstanceId,
        branchId: context.installation.branchId,
        actorUserId: context.operator.actorUserId,
        correlationId: normalizeCorrelationId(correlationId ?? request.id),
        householdIds,
        customerId,
      }),
      this.identityLookup.lookup([customerId]),
    ]);
    return edgeCustomerProfileSchema.parse({
      ...profile,
      maskedPhone: phones.get(customerId.toLowerCase()) ?? null,
    });
  }

  @Get('households/:householdId')
  async readHousehold(
    @Param('householdId', new ParseUUIDPipe()) householdId: string,
    @Query() rawQuery: unknown,
    @Headers('x-edge-installation-id') installationId: string | undefined,
    @Headers('x-edge-key-id') keyId: string | undefined,
    @Headers('x-edge-signature') signature: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const query = householdQuerySchema.safeParse(rawQuery);
    if (!query.success) throw new BadRequestException('Edge household query is invalid.');
    const context = await this.authorize({
      installationId,
      keyId,
      signature,
      authorization,
      request,
      branchId: query.data.branchId,
      permission: 'customer.family.read',
    });
    const householdIds = await this.branchHouseholds(
      context.installation.organizationId,
      context.installation.branchId,
    );
    if (!householdIds.some((id) => id.toLowerCase() === householdId.toLowerCase()))
      throw new UnauthorizedException('Household is not available in this branch.');
    const result = await this.householdOperations.readHousehold({
      sourceInstanceId: context.installation.sourceInstanceId,
      branchId: context.installation.branchId,
      actorUserId: context.operator.actorUserId,
      correlationId: normalizeCorrelationId(correlationId ?? request.id),
      householdId,
    });
    return edgeHouseholdReadSchema.parse(result);
  }

  @Patch('customers/:customerId')
  async updateCustomer(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Body() rawBody: unknown,
    @Headers('x-edge-installation-id') installationId: string | undefined,
    @Headers('x-edge-key-id') keyId: string | undefined,
    @Headers('x-edge-signature') signature: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const body = edgeCustomerProfilePatchRequestSchema.safeParse(rawBody);
    if (!body.success || !uuid.safeParse(idempotencyKey).success)
      throw new BadRequestException('Edge profile update request is invalid.');
    const context = await this.authorize({
      installationId,
      keyId,
      signature,
      authorization,
      request,
      branchId: body.data.branchId,
      permission: 'customer.profile.manage',
    });
    const householdIds = await this.branchHouseholds(
      context.installation.organizationId,
      context.installation.branchId,
    );
    const { branchId, ...update } = body.data;
    const result = await this.householdOperations.updateCustomer({
      sourceInstanceId: context.installation.sourceInstanceId,
      branchId,
      householdIds,
      customerId,
      ...update,
      actorUserId: context.operator.actorUserId,
      correlationId: normalizeCorrelationId(correlationId ?? request.id),
      idempotencyKey: idempotencyKey!,
    });
    const phones = await this.identityLookup.lookup([customerId]);
    return edgeProfileMutationResultSchema.parse({
      customerId: result.userId,
      recordVersion: result.version,
      maskedPhone: phones.get(customerId.toLowerCase()) ?? null,
    });
  }

  @Patch('households/:householdId')
  async updateHousehold(
    @Param('householdId', new ParseUUIDPipe()) householdId: string,
    @Body() rawBody: unknown,
    @Headers('x-edge-installation-id') installationId: string | undefined,
    @Headers('x-edge-key-id') keyId: string | undefined,
    @Headers('x-edge-signature') signature: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const body = edgeHouseholdPatchRequestSchema.safeParse(rawBody);
    if (!body.success || !uuid.safeParse(idempotencyKey).success)
      throw new BadRequestException('Edge household update request is invalid.');
    const context = await this.authorize({
      installationId,
      keyId,
      signature,
      authorization,
      request,
      branchId: body.data.branchId,
      permission: 'customer.family.manage',
    });
    await this.requireBranchHousehold(
      context.installation.organizationId,
      context.installation.branchId,
      householdId,
    );
    const result = await this.householdOperations.updateHousehold({
      sourceInstanceId: context.installation.sourceInstanceId,
      branchId: body.data.branchId,
      householdId,
      expectedVersion: body.data.expectedVersion,
      name: body.data.name,
      actorUserId: context.operator.actorUserId,
      correlationId: normalizeCorrelationId(correlationId ?? request.id),
      idempotencyKey: idempotencyKey!,
    });
    return edgeHouseholdMutationResultSchema.parse({
      householdId: result.id,
      recordVersion: result.version,
    });
  }

  @Post('households/:householdId/members')
  @HttpCode(HttpStatus.CREATED)
  async addHouseholdMember(
    @Param('householdId', new ParseUUIDPipe()) householdId: string,
    @Body() rawBody: unknown,
    @Headers('x-edge-installation-id') installationId: string | undefined,
    @Headers('x-edge-key-id') keyId: string | undefined,
    @Headers('x-edge-signature') signature: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const body = edgeHouseholdMemberCreateRequestSchema.safeParse(rawBody);
    if (!body.success || !uuid.safeParse(idempotencyKey).success)
      throw new BadRequestException('Edge household member request is invalid.');
    const context = await this.authorize({
      installationId,
      keyId,
      signature,
      authorization,
      request,
      branchId: body.data.branchId,
      permission: 'customer.family.manage',
    });
    await this.requireBranchHousehold(
      context.installation.organizationId,
      context.installation.branchId,
      householdId,
    );
    const result = await this.householdOperations.addMember({
      ...body.data,
      sourceInstanceId: context.installation.sourceInstanceId,
      householdId,
      actorUserId: context.operator.actorUserId,
      correlationId: normalizeCorrelationId(correlationId ?? request.id),
      idempotencyKey: idempotencyKey!,
    });
    return edgeHouseholdMemberMutationResultSchema.parse({
      memberId: result.id,
      householdId: result.householdId,
      recordVersion: result.version,
    });
  }

  @Post('cards/assignments')
  @HttpCode(HttpStatus.CREATED)
  async assignCard(
    @Body() rawBody: unknown,
    @Headers('x-edge-installation-id') installationId: string | undefined,
    @Headers('x-edge-key-id') keyId: string | undefined,
    @Headers('x-edge-signature') signature: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const body = edgeCardAssignmentRequestSchema.safeParse(rawBody);
    if (!body.success || !uuid.safeParse(idempotencyKey).success)
      throw new BadRequestException('Edge card assignment request is invalid.');
    const context = await this.authorize({
      installationId,
      keyId,
      signature,
      authorization,
      request,
      permission: 'card.assign',
    });
    const assignment = await this.cardOperations.assign({
      organizationId: context.installation.organizationId,
      branchId: context.installation.branchId,
      cardId: body.data.cardId,
      householdId: body.data.householdId,
      memberId: body.data.memberId ?? null,
      expectedVersion: body.data.expectedVersion,
      reason: body.data.reason,
      actorUserId: context.operator.actorUserId,
      correlationId: normalizeCorrelationId(correlationId ?? request.id),
      idempotencyKey: idempotencyKey!,
    });
    return edgeCardAssignmentResultSchema.parse({
      assignmentId: assignment.id,
      cardId: assignment.cardId,
      householdId: assignment.householdId,
      memberId: assignment.memberId,
      status: assignment.status,
      verificationStatus: assignment.verificationStatus,
      maskedIdentifier: assignment.maskedIdentifier,
    });
  }

  @Post('cards/:cardId/block')
  @HttpCode(HttpStatus.OK)
  async blockCard(
    @Param('cardId', new ParseUUIDPipe()) cardId: string,
    @Body() rawBody: unknown,
    @Headers('x-edge-installation-id') installationId: string | undefined,
    @Headers('x-edge-key-id') keyId: string | undefined,
    @Headers('x-edge-signature') signature: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const body = edgeCardCommandRequestSchema.safeParse(rawBody);
    if (!body.success || !uuid.safeParse(idempotencyKey).success)
      throw new BadRequestException('Edge card block request is invalid.');
    const context = await this.authorize({
      installationId,
      keyId,
      signature,
      authorization,
      request,
      permission: 'card.inventory.manage',
    });
    const card = await this.cardOperations.block({
      organizationId: context.installation.organizationId,
      branchId: context.installation.branchId,
      cardId,
      expectedVersion: body.data.expectedVersion,
      reason: body.data.reason,
      actorUserId: context.operator.actorUserId,
      correlationId: normalizeCorrelationId(correlationId ?? request.id),
      idempotencyKey: idempotencyKey!,
    });
    return edgeCardBlockResultSchema.parse({
      cardId: card.id,
      status: card.status,
      recordVersion: card.version,
      maskedIdentifier: card.maskedIdentifier,
    });
  }

  @Post('cards/:cardId/replacement-requests')
  @HttpCode(HttpStatus.CREATED)
  async requestCardReplacement(
    @Param('cardId', new ParseUUIDPipe()) cardId: string,
    @Body() rawBody: unknown,
    @Headers('x-edge-installation-id') installationId: string | undefined,
    @Headers('x-edge-key-id') keyId: string | undefined,
    @Headers('x-edge-signature') signature: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const body = edgeCardCommandRequestSchema.safeParse(rawBody);
    if (!body.success || !uuid.safeParse(idempotencyKey).success)
      throw new BadRequestException('Edge card replacement request is invalid.');
    const context = await this.authorize({
      installationId,
      keyId,
      signature,
      authorization,
      request,
      permission: 'card.inventory.manage',
    });
    const mappings = await this.walletMappings.listMappings(
      context.installation.organizationId,
      context.installation.branchId,
    );
    const mapping = mappings.find((item) => item.cardId.toLowerCase() === cardId.toLowerCase());
    if (!mapping) throw new UnauthorizedException('Card is not available in this branch.');
    const result = await this.cardOperations.requestReplacement({
      householdId: mapping.householdId,
      cardId,
      expectedVersion: body.data.expectedVersion,
      reason: body.data.reason,
      actorUserId: context.operator.actorUserId,
      correlationId: normalizeCorrelationId(correlationId ?? request.id),
      idempotencyKey: idempotencyKey!,
    });
    return edgeCardReplacementRequestResultSchema.parse({
      requestId: result.id,
      cardId: result.cardId,
      status: result.status,
      duplicate: result.duplicate ?? false,
    });
  }

  private async authorize(input: {
    installationId: string | undefined;
    keyId: string | undefined;
    signature: string | undefined;
    authorization: string | undefined;
    request: FastifyRequest;
    branchId?: string;
    permission: Parameters<EdgeOperatorTokenClient['validate']>[2];
  }) {
    const rawBody = (input.request as FastifyRequest & { rawBody?: Buffer }).rawBody;
    const signedBody = rawBody ?? (input.request.method === 'GET' ? Buffer.alloc(0) : null);
    if (!signedBody) throw new ServiceUnavailableException('Raw Edge request body is unavailable.');
    if (!this.signatureVerifier.isEdgeConfigured())
      throw new ServiceUnavailableException('Edge authentication is not configured.');
    if (!this.signatureVerifier.verifyEdge(signedBody, input.keyId, input.signature))
      throw new UnauthorizedException('Edge signature is invalid.');
    if (!uuid.safeParse(input.installationId).success)
      throw new UnauthorizedException('Edge installation identity is invalid.');
    const installation = await this.registry.getEdgeInstallation(input.installationId!);
    if (
      !installation ||
      installation.status !== 'active' ||
      (installation.currentKeyId !== input.keyId && installation.previousKeyId !== input.keyId) ||
      (input.branchId !== undefined &&
        installation.branchId.toLowerCase() !== input.branchId.toLowerCase())
    )
      throw new UnauthorizedException('Edge installation is not authorized for this branch.');
    if (!(await this.registry.consumeEdgeRequestQuota(input.installationId!)))
      throw new HttpException('Edge request rate limit exceeded.', HttpStatus.TOO_MANY_REQUESTS);
    const operator = await this.operatorTokens.validate(
      parseBearerToken(input.authorization),
      installation.branchId,
      input.permission,
    );
    return { installation, operator };
  }

  private async branchHouseholds(organizationId: string, branchId: string) {
    const mappings = await this.walletMappings.listMappings(organizationId, branchId);
    return [...new Set(mappings.map((mapping) => mapping.householdId))];
  }

  private async requireBranchHousehold(
    organizationId: string,
    branchId: string,
    householdId: string,
  ) {
    const householdIds = await this.branchHouseholds(organizationId, branchId);
    if (!householdIds.some((id) => id.toLowerCase() === householdId.toLowerCase()))
      throw new UnauthorizedException('Household is not available in this branch.');
    return householdIds;
  }
}

function parseBearerToken(value: string | undefined) {
  const match = /^Bearer ([A-Za-z0-9._~-]{32,256})$/u.exec(value ?? '');
  if (!match) throw new UnauthorizedException('A valid Edge operator token is required.');
  return match[1]!;
}
