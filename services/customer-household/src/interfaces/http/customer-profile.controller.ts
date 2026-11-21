import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { CustomerProfileService } from '../../application/customer-profile.service.js';
import { CustomerHouseholdServiceTokenGuard } from './service-token.guard.js';

const uuid = z.string().uuid();
const profileUpdateSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
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
  })
  .strict()
  .refine((value) => Object.keys(value).some((key) => key !== 'expectedVersion'));
const avatarSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    dataBase64: z.string().min(4).max(2_666_668),
  })
  .strict();

@Controller('internal/v1/customer-profiles')
@UseGuards(CustomerHouseholdServiceTokenGuard)
export class CustomerProfileController {
  constructor(private readonly profiles: CustomerProfileService) {}

  @Get(':userId')
  @Header('cache-control', 'no-store, private')
  @Header('pragma', 'no-cache')
  get(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Headers('x-funtino-actor-user-id') actor: string | undefined,
  ) {
    this.assertOwner(userId, actor);
    return this.profiles.get(userId);
  }

  @Patch(':userId')
  @Header('cache-control', 'no-store, private')
  @Header('pragma', 'no-cache')
  update(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Headers('x-funtino-actor-user-id') actor: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Body() rawBody: unknown,
  ) {
    this.assertOwner(userId, actor);
    const parsed = profileUpdateSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException('Customer profile request is invalid.');
    const { expectedVersion, ...input } = parsed.data;
    const meta = this.commandMeta(expectedVersion, idempotencyKey, correlationId);
    return this.profiles.update(userId, input, meta);
  }

  @Put(':userId/avatar')
  @Header('cache-control', 'no-store, private')
  @Header('pragma', 'no-cache')
  saveAvatar(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Headers('x-funtino-actor-user-id') actor: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Body() rawBody: unknown,
  ) {
    this.assertOwner(userId, actor);
    const parsed = avatarSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException('Customer avatar request is invalid.');
    return this.profiles.saveAvatar(
      userId,
      parsed.data,
      this.commandMeta(parsed.data.expectedVersion, idempotencyKey, correlationId),
    );
  }

  @Get(':userId/avatar')
  @Header('cache-control', 'no-store, private')
  @Header('pragma', 'no-cache')
  getAvatar(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Headers('x-funtino-actor-user-id') actor: string | undefined,
  ) {
    this.assertOwner(userId, actor);
    return this.profiles.getAvatar(userId);
  }

  private assertOwner(userId: string, actor: string | undefined) {
    if (!uuid.safeParse(actor).success || actor?.toLowerCase() !== userId.toLowerCase()) {
      throw new BadRequestException('Actor does not match the requested customer.');
    }
  }

  private commandMeta(
    expectedVersion: number | undefined,
    idempotencyKey: string | undefined,
    correlationId: string | undefined,
  ) {
    if (
      !expectedVersion ||
      !uuid.safeParse(idempotencyKey).success ||
      !uuid.safeParse(correlationId).success
    ) {
      throw new BadRequestException('Version, idempotency key, and correlation ID are required.');
    }
    return { expectedVersion, idempotencyKey: idempotencyKey!, correlationId: correlationId! };
  }
}
