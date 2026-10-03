import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import {
  branchInputSchema,
  branchUpdateSchema,
  organizationInputSchema,
  organizationUpdateSchema,
  OrganizationBranchService,
  statusInputSchema,
  type CommandMeta,
} from '../../application/organization-branch.service.js';
import { OrganizationBranchServiceTokenGuard } from './service-token.guard.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const uuid = z.string().uuid();
const pageQuerySchema = z
  .object({
    cursor: uuid.optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
const branchPageQuerySchema = pageQuerySchema.extend({ organizationId: uuid.optional() });
const scopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('organization'), organizationId: uuid }).strict(),
  z.object({ type: z.literal('branch'), organizationId: uuid, branchId: uuid }).strict(),
]);

@Controller('internal/v1')
@UseGuards(OrganizationBranchServiceTokenGuard)
export class OrganizationBranchController {
  constructor(private readonly service: OrganizationBranchService) {}

  @Get('organizations')
  listOrganizations(
    @Query(new ZodValidationPipe(pageQuerySchema)) page: z.infer<typeof pageQuerySchema>,
  ) {
    return this.service.listOrganizations(page);
  }

  @Post('organizations')
  createOrganization(
    @Body(new ZodValidationPipe(organizationInputSchema))
    body: z.infer<typeof organizationInputSchema>,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.service.createOrganization(body, this.commandMeta(headers));
  }

  @Get('organizations/:organizationId')
  getOrganization(@Param('organizationId') organizationId: string) {
    return this.service.getOrganization(parseUuid(organizationId));
  }

  @Patch('organizations/:organizationId')
  updateOrganization(
    @Param('organizationId') organizationId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body(new ZodValidationPipe(organizationUpdateSchema))
    body: z.infer<typeof organizationUpdateSchema>,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.service.updateOrganization(
      parseUuid(organizationId),
      this.version(ifMatch),
      body,
      this.commandMeta(headers),
    );
  }

  @Post('organizations/:organizationId/status')
  @HttpCode(200)
  changeOrganizationStatus(
    @Param('organizationId') organizationId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body(new ZodValidationPipe(statusInputSchema)) body: z.infer<typeof statusInputSchema>,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.service.changeOrganizationStatus(
      parseUuid(organizationId),
      this.version(ifMatch),
      body,
      this.commandMeta(headers),
    );
  }

  @Get('organizations/:organizationId/branches')
  listBranches(
    @Param('organizationId') organizationId: string,
    @Query(new ZodValidationPipe(pageQuerySchema)) page: z.infer<typeof pageQuerySchema>,
  ) {
    return this.service.listBranches({ ...page, organizationId: parseUuid(organizationId) });
  }

  @Post('organizations/:organizationId/branches')
  createBranch(
    @Param('organizationId') organizationId: string,
    @Body(new ZodValidationPipe(branchInputSchema)) body: z.infer<typeof branchInputSchema>,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.service.createBranch(parseUuid(organizationId), body, this.commandMeta(headers));
  }

  @Get('organizations/:organizationId/branches/:branchId')
  getBranch(@Param('organizationId') organizationId: string, @Param('branchId') branchId: string) {
    return this.service.getBranch(parseUuid(organizationId), parseUuid(branchId));
  }

  @Patch('organizations/:organizationId/branches/:branchId')
  updateBranch(
    @Param('organizationId') organizationId: string,
    @Param('branchId') branchId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body(new ZodValidationPipe(branchUpdateSchema)) body: z.infer<typeof branchUpdateSchema>,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.service.updateBranch(
      parseUuid(organizationId),
      parseUuid(branchId),
      this.version(ifMatch),
      body,
      this.commandMeta(headers),
    );
  }

  @Post('organizations/:organizationId/branches/:branchId/status')
  @HttpCode(200)
  changeBranchStatus(
    @Param('organizationId') organizationId: string,
    @Param('branchId') branchId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body(new ZodValidationPipe(statusInputSchema)) body: z.infer<typeof statusInputSchema>,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.service.changeBranchStatus(
      parseUuid(organizationId),
      parseUuid(branchId),
      this.version(ifMatch),
      body,
      this.commandMeta(headers),
    );
  }

  @Get('branches')
  listAllBranches(
    @Query(new ZodValidationPipe(branchPageQuerySchema))
    page: z.infer<typeof branchPageQuerySchema>,
  ) {
    return this.service.listBranches(page);
  }

  @Get('public/branches')
  listPublicBranches(
    @Query(new ZodValidationPipe(pageQuerySchema)) page: z.infer<typeof pageQuerySchema>,
  ) {
    return this.service.listPublicBranches(page);
  }

  @Get('public/branches/:branchId')
  getPublicBranch(@Param('branchId') branchId: string) {
    return this.service.getPublicBranch(parseUuid(branchId));
  }

  @Post('scopes/validate')
  validateScope(@Body(new ZodValidationPipe(scopeSchema)) body: z.infer<typeof scopeSchema>) {
    return this.service.validateScope(body);
  }

  private commandMeta(headers: Record<string, string | string[] | undefined>): CommandMeta {
    const single = (name: string): string | undefined => {
      const value = headers[name];
      return typeof value === 'string' ? value : undefined;
    };
    const callerService = single('x-funtino-service-id');
    if (callerService !== 'api-gateway' && callerService !== 'identity-access') {
      throw new BadRequestException('Authenticated service identity is missing.');
    }
    return {
      callerService,
      idempotencyKey: this.headerUuid(single('idempotency-key')),
      actorUserId: this.headerUuid(single('x-funtino-actor-user-id')),
      correlationId: this.headerUuid(single('x-correlation-id')),
    };
  }

  private version(value: string | undefined): number {
    if (!value) throw new BadRequestException('If-Match is required for updates.');
    const normalized = value.trim().replace(/^"|"$/g, '');
    const version = Number(normalized);
    if (!Number.isSafeInteger(version) || version < 1)
      throw new BadRequestException('If-Match must contain a positive resource version.');
    return version;
  }

  private headerUuid(value: string | undefined): string {
    const result = uuid.safeParse(value);
    if (!result.success)
      throw new BadRequestException(
        'A valid idempotency, actor or correlation UUID header is required.',
      );
    return result.data;
  }
}

function parseUuid(value: string): string {
  const result = uuid.safeParse(value);
  if (!result.success) throw new BadRequestException('A valid UUID is required.');
  return result.data;
}
