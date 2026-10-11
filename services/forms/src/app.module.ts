import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RabbitEventBus } from '@funtino/backend-core';
import { FormsService } from './application/forms.service.js';
import { FormsOutboxRelay, FORMS_EVENT_BUS, FORMS_RABBIT_URL } from './infrastructure/messaging/forms-outbox-relay.service.js';
import { PrismaService } from './infrastructure/persistence/prisma/prisma.service.js';
import { FormsController, PublicFormsController, SystemFormsController } from './interfaces/http/forms.controller.js';
import { FormsServiceTokenGuard } from './interfaces/http/service-token.guard.js';
import { FormsHealthController } from './interfaces/http/health.controller.js';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [FormsHealthController, FormsController, PublicFormsController, SystemFormsController],
  providers: [
    PrismaService,
    FormsService,
    FormsServiceTokenGuard,
    FormsOutboxRelay,
    { provide: FORMS_EVENT_BUS, useFactory: () => new RabbitEventBus(process.env.RABBITMQ_URL, 'forms') },
    { provide: FORMS_RABBIT_URL, useFactory: () => process.env.RABBITMQ_URL },
  ],
})
export class AppModule {}
