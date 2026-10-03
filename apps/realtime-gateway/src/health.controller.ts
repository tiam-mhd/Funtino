import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get('live')
  live() {
    return { status: 'success', data: { status: 'ok', service: 'realtime-gateway' } };
  }

  @Get('ready')
  ready() {
    return {
      status: 'success',
      data: { status: 'ready', rabbitConfigured: Boolean(process.env.RABBITMQ_URL) },
    };
  }
}
