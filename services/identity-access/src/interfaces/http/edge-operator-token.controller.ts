import {
  BadRequestException,
  Body,
  Controller,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import {
  EDGE_OPERATOR_PERMISSIONS,
  EdgeOperatorTokenService,
  type EdgeOperatorPermission,
} from '../../application/edge-operator-token.service.js';
import {
  EdgeOperatorGatewayTokenGuard,
  EdgeOperatorDeviceIntegrationTokenGuard,
} from './edge-operator-token.guards.js';

const uuid = z.string().uuid();
const issueSchema = z
  .object({
    organizationId: uuid,
    branchId: uuid,
    permissionKeys: z
      .array(z.enum(EDGE_OPERATOR_PERMISSIONS))
      .min(1)
      .max(EDGE_OPERATOR_PERMISSIONS.length),
  })
  .strict()
  .refine((value) => new Set(value.permissionKeys).size === value.permissionKeys.length);
const validateSchema = z
  .object({
    token: z.string().min(32).max(256),
    branchId: uuid,
    permission: z.enum(EDGE_OPERATOR_PERMISSIONS),
  })
  .strict();
const revokeSchema = z.object({ sessionId: uuid }).strict();

@Controller('internal/v1/edge-operator-tokens')
export class EdgeOperatorTokenController {
  constructor(private readonly tokens: EdgeOperatorTokenService) {}

  @Post()
  @UseGuards(EdgeOperatorGatewayTokenGuard)
  @Header('cache-control', 'no-store, private')
  @Header('pragma', 'no-cache')
  issue(
    @Headers('x-funtino-actor-user-id') actor: string | undefined,
    @Headers('x-funtino-session-id') sessionId: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Body() rawBody: unknown,
  ) {
    const parsed = issueSchema.safeParse(rawBody);
    if (
      !parsed.success ||
      !uuid.safeParse(actor).success ||
      !uuid.safeParse(sessionId).success ||
      !uuid.safeParse(correlationId).success
    ) {
      throw new BadRequestException('Edge operator token request is invalid.');
    }
    return this.tokens.issue({
      actorUserId: actor!,
      sessionId: sessionId!,
      scope: {
        type: 'branch',
        organizationId: parsed.data.organizationId,
        branchId: parsed.data.branchId,
      },
      permissionKeys: parsed.data.permissionKeys as EdgeOperatorPermission[],
      correlationId: correlationId!,
    });
  }

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(EdgeOperatorDeviceIntegrationTokenGuard)
  @Header('cache-control', 'no-store, private')
  @Header('pragma', 'no-cache')
  validate(@Body() rawBody: unknown) {
    const parsed = validateSchema.safeParse(rawBody);
    if (!parsed.success)
      throw new BadRequestException('Edge operator token validation request is invalid.');
    return this.tokens.validate(parsed.data);
  }

  @Post('revoke-session')
  @HttpCode(HttpStatus.OK)
  @UseGuards(EdgeOperatorGatewayTokenGuard)
  @Header('cache-control', 'no-store, private')
  @Header('pragma', 'no-cache')
  revokeSession(
    @Headers('x-funtino-actor-user-id') actor: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Body() rawBody: unknown,
  ) {
    const parsed = revokeSchema.safeParse(rawBody);
    if (
      !parsed.success ||
      !uuid.safeParse(actor).success ||
      !uuid.safeParse(correlationId).success
    ) {
      throw new BadRequestException('Edge operator token revocation request is invalid.');
    }
    return this.tokens.revokeSession({
      actorUserId: actor!,
      sessionId: parsed.data.sessionId,
      correlationId: correlationId!,
    });
  }
}
