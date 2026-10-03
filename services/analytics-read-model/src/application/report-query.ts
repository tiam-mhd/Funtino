import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const uuid = z.string().uuid();
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const reportFilterSchema = z
  .object({
    scopeType: z.enum(['organization', 'branch']),
    organizationId: uuid,
    branchId: uuid.optional(),
    from: dateOnly,
    to: dateOnly,
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.scopeType === 'branch') !== Boolean(value.branchId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid report scope.' });
    }
    const from = parseDateOnly(value.from);
    const to = parseDateOnly(value.to);
    if (!from || !to || to < from) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid report period.' });
    } else if ((to.getTime() - from.getTime()) / 86_400_000 + 1 > 366) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Report period exceeds 366 days.' });
    } else {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      if (to > today)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Report period cannot include future dates.',
        });
    }
  });

export type ReportFilter = z.infer<typeof reportFilterSchema>;

export function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value
    ? null
    : parsed;
}

export function assertReportFilter(input: unknown): ReportFilter & { fromDay: Date; toDay: Date } {
  const parsed = reportFilterSchema.safeParse(input);
  if (!parsed.success) throw new BadRequestException('The report scope or date range is invalid.');
  const fromDay = parseDateOnly(parsed.data.from);
  const toDay = parseDateOnly(parsed.data.to);
  if (!fromDay || !toDay) throw new BadRequestException('The report date is invalid.');
  return { ...parsed.data, fromDay, toDay };
}
