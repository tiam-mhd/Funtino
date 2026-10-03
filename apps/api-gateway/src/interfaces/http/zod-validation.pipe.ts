import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import { z, type ZodType } from 'zod';

@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new BadRequestException({
      status: 'error',
      error: {
        code: 'VALIDATION_ERROR',
        message: 'اطلاعات ارسالی معتبر نیست.',
        details: result.error.flatten(),
      },
    });
  }
}

export const uuidSchema = z.string().uuid();
