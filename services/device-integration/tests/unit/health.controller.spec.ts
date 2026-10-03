import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceUnavailableException } from '@nestjs/common';
import type { DeviceRegistryService } from '../../src/application/device-registry.service.js';
import { HealthController } from '../../src/interfaces/http/health.controller.js';
import type { PrismaService } from '../../src/infrastructure/persistence/prisma/prisma.service.js';

test('readiness reports durable outbox backlog and dead-letter state', async () => {
  const previousRabbitUrl = process.env.RABBITMQ_URL;
  try {
    delete process.env.RABBITMQ_URL;
    const controller = new HealthController(
      { isReady: async () => {} } as DeviceRegistryService,
      {
        outboxEvent: {
          count: async ({ where }: { where: Record<string, unknown> }) =>
            where.deadLetteredAt && typeof where.deadLetteredAt === 'object' ? 2 : 7,
        },
      } as unknown as PrismaService,
    );
    assert.deepEqual(await controller.ready(), {
      status: 'success',
      data: {
        status: 'ready',
        service: 'device-integration',
        outbox: { pending: 7, deadLettered: 2, publisherConfigured: false },
      },
    });
  } finally {
    if (previousRabbitUrl === undefined) delete process.env.RABBITMQ_URL;
    else process.env.RABBITMQ_URL = previousRabbitUrl;
  }
});

test('readiness fails closed if durable outbox health cannot be read', async () => {
  const controller = new HealthController(
    { isReady: async () => {} } as DeviceRegistryService,
    {
      outboxEvent: { count: async () => Promise.reject(new Error('database unavailable')) },
    } as unknown as PrismaService,
  );
  await assert.rejects(() => controller.ready(), ServiceUnavailableException);
});
