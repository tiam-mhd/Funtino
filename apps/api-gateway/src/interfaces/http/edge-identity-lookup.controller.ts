import {
  Body,
  BadRequestException,
  CanActivate,
  Controller,
  HttpCode,
  HttpStatus,
  Injectable,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
  type ExecutionContext,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service.js';

const lookupSchema = z.object({ userIds: z.array(z.string().uuid()).min(1).max(100) }).strict();

@Injectable()
class DeviceIntegrationGatewayTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const configured = process.env.DEVICE_INTEGRATION_GATEWAY_TOKEN;
    const supplied = request.headers['x-funtino-service-token'];
    if (!configured || configured.length < 32 || configured.length > 512) {
      throw new ServiceUnavailableException('Internal identity lookup is not configured.');
    }
    if (
      request.method !== 'POST' ||
      request.routeOptions.url !== '/internal/v1/edge/identities/lookup' ||
      request.headers['x-funtino-service-id'] !== 'device-integration' ||
      typeof supplied !== 'string' ||
      supplied.length < 32 ||
      supplied.length > 512 ||
      !timingSafeEqual(
        createHash('sha256').update(configured).digest(),
        createHash('sha256').update(supplied).digest(),
      )
    ) {
      throw new UnauthorizedException('Device Integration identity is not authorized.');
    }
    return true;
  }
}

@Controller('internal/v1/edge')
@UseGuards(DeviceIntegrationGatewayTokenGuard)
export class EdgeIdentityLookupController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('identities/lookup')
  @HttpCode(HttpStatus.OK)
  async lookup(@Body() rawBody: unknown) {
    const parsed = lookupSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException('Identity lookup request is invalid.');
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(parsed.data.userIds)] } },
      select: { id: true, phoneE164: true },
    });
    return {
      items: users.map((user) => ({ customerId: user.id, maskedPhone: maskPhone(user.phoneE164) })),
    };
  }
}

function maskPhone(value: string) {
  if (value.length <= 6) return '••••';
  return `${value.slice(0, 4)}${'•'.repeat(Math.min(8, value.length - 6))}${value.slice(-2)}`;
}
