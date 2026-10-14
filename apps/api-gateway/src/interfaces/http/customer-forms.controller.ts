import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { FormsClient } from '../../infrastructure/forms/forms.client.js';
import { requestCorrelationId, success } from './current-user.decorator.js';
import type { AuthenticatedRequest } from './current-user.decorator.js';
import { CustomerOptionalSessionGuard } from './customer-optional-session.guard.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const uuid = z.string().uuid();
const slug = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u);
const listSchema = z.object({ branchId: uuid.optional() }).strict();
const submitSchema = z
  .object({
    answers: z.record(z.unknown()),
    idempotencyKey: z.string().trim().min(16).max(80),
    linkToAccountConsent: z.boolean().default(false),
    linkParameters: z
      .object({
        source: z.string().max(160).optional(),
        campaign: z.string().max(160).optional(),
        ref: z.string().max(160).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

@Controller('api/v1/customer/forms')
export class CustomerFormsController {
  constructor(private readonly forms: FormsClient) {}

  @Get('session')
  @UseGuards(CustomerOptionalSessionGuard)
  session(@Req() request: AuthenticatedRequest) {
    return success(
      { authenticated: Boolean(request.user?.id && request.session?.audience === 'customer') },
      request,
    );
  }

  @Get()
  async list(
    @Query(new ZodValidationPipe(listSchema)) query: z.infer<typeof listSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    return success(
      await this.forms.request('/internal/v1/public/forms', {
        query,
        correlationId: requestCorrelationId(request),
      }),
      request,
    );
  }

  @Get(':slug')
  async get(
    @Param('slug', new ZodValidationPipe(slug)) formSlug: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return success(
      await this.forms.request(`/internal/v1/public/forms/${encodeURIComponent(formSlug)}`, {
        correlationId: requestCorrelationId(request),
      }),
      request,
    );
  }

  @Post(':slug/responses')
  @UseGuards(CustomerOptionalSessionGuard)
  async submit(
    @Param('slug', new ZodValidationPipe(slug)) formSlug: string,
    @Body(new ZodValidationPipe(submitSchema)) body: z.infer<typeof submitSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = requestCorrelationId(request);
    const customerId = request.user?.id;
    const linkedCustomerId = customerId && body.linkToAccountConsent ? customerId : undefined;
    return success(
      await this.forms.request(
        `/internal/v1/public/forms/${encodeURIComponent(formSlug)}/responses`,
        {
          method: 'POST',
          body: {
            ...body,
            isAuthenticated: Boolean(customerId),
            ...(linkedCustomerId ? { customerId: linkedCustomerId } : {}),
            correlationId,
          },
          correlationId,
        },
      ),
      request,
    );
  }
}
