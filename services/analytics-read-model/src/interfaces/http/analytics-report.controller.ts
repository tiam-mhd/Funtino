import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Header,
  Headers,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OperationsReportService } from '../../application/operations-report.service.js';
import { reportFilterSchema } from '../../application/report-query.js';
import { AnalyticsServiceTokenGuard } from './service-token.guard.js';

@Controller('internal/v1/reports')
@UseGuards(AnalyticsServiceTokenGuard)
export class AnalyticsReportController {
  constructor(private readonly reports: OperationsReportService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async read(@Query() query: unknown) {
    return this.reports.getReport(query);
  }

  @Post('export')
  @Header('Cache-Control', 'private, no-store')
  async export(
    @Body() body: unknown,
    @Headers('x-funtino-actor-user-id') actorUserId: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
  ) {
    const filter = reportFilterSchema.safeParse(body);
    if (!filter.success || !actorUserId || !correlationId) {
      throw new BadRequestException('The analytics export request is invalid.');
    }
    return this.reports.exportReport(filter.data, actorUserId, correlationId);
  }
}
