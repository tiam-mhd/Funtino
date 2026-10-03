import { BadRequestException, HttpException, HttpStatus, Logger } from '@nestjs/common';
import amqp, { type ConfirmChannel, type Connection, type ConsumeMessage } from 'amqplib';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  eventEnvelopeSchema,
  rabbitDeadLetterExchange,
  rabbitExchange,
  type EventEnvelope,
} from '@funtino/event-contracts';
export { installHttpTelemetry } from './observability/http-telemetry.js';
export type { HttpTelemetryOptions } from './observability/http-telemetry.js';

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'DEPENDENCY_UNAVAILABLE';

export class DomainError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
    public readonly status = statusForError(code),
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

function statusForError(code: ApiErrorCode): number {
  switch (code) {
    case 'VALIDATION_ERROR':
      return HttpStatus.BAD_REQUEST;
    case 'UNAUTHENTICATED':
      return HttpStatus.UNAUTHORIZED;
    case 'FORBIDDEN':
      return HttpStatus.FORBIDDEN;
    case 'NOT_FOUND':
      return HttpStatus.NOT_FOUND;
    case 'CONFLICT':
      return HttpStatus.CONFLICT;
    case 'RATE_LIMITED':
      return HttpStatus.TOO_MANY_REQUESTS;
    case 'DEPENDENCY_UNAVAILABLE':
      return HttpStatus.SERVICE_UNAVAILABLE;
  }
}

export function toHttpException(error: unknown): HttpException {
  if (error instanceof DomainError) {
    return new HttpException(
      {
        status: 'error',
        error: {
          code: error.code,
          message: error.message,
          details: error.details ?? null,
        },
      },
      error.status,
    );
  }

  if (error instanceof BadRequestException) {
    return error;
  }

  return new HttpException(
    {
      status: 'error',
      error: {
        code: 'INTERNAL_ERROR',
        message: 'خطای غیرمنتظره‌ای رخ داد.',
      },
    },
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}

export interface RequestContext {
  requestId: string;
  correlationId: string;
  userId?: string;
  organizationId?: string;
  branchId?: string;
  roles: string[];
}

export function requestContextFromHeaders(headers: Record<string, unknown>): RequestContext {
  const requestId = stringHeader(headers['x-request-id']) ?? crypto.randomUUID();
  const correlationId = stringHeader(headers['x-correlation-id']) ?? requestId;
  return { requestId, correlationId, roles: [] };
}

function stringHeader(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function generateOpaqueSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeCorrelationId(value: unknown): string {
  return typeof value === 'string' && uuidPattern.test(value) ? value : randomUUID();
}

export interface EventBus {
  publish(event: EventEnvelope): Promise<void>;
  close(): Promise<void>;
}

export class RabbitEventBus implements EventBus {
  private connection?: Connection;
  private channel?: ConfirmChannel;
  private readonly logger = new Logger(RabbitEventBus.name);

  constructor(
    private readonly url: string | undefined,
    private readonly sourceId: string,
  ) {}

  private async ensureChannel(): Promise<ConfirmChannel | undefined> {
    if (!this.url) return undefined;
    if (this.channel) return this.channel;

    this.connection = await amqp.connect(this.url);
    this.channel = await this.connection.createConfirmChannel();
    await this.channel.assertExchange(rabbitExchange, 'topic', { durable: true });
    this.connection.on('error', (error) => {
      this.logger.error(
        { errorType: error instanceof Error ? error.name.slice(0, 80) : 'UnknownError' },
        'rabbit connection error',
      );
    });
    return this.channel;
  }

  async publish(event: EventEnvelope): Promise<void> {
    const parsed = eventEnvelopeSchema.parse(event);
    const channel = await this.ensureChannel();
    if (!channel) {
      this.logger.warn({ eventType: parsed.eventType }, 'rabbit disabled; event remains in outbox');
      return;
    }

    channel.publish(rabbitExchange, parsed.eventType, Buffer.from(JSON.stringify(parsed)), {
      contentType: 'application/json',
      persistent: true,
      appId: this.sourceId,
      messageId: parsed.eventId,
    });
    await channel.waitForConfirms();
  }

  async close(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
  }
}

export interface ConsumerHandler {
  (event: EventEnvelope, message: ConsumeMessage): Promise<void>;
}

export async function consumeRabbitQueue(input: {
  url?: string;
  queue: string;
  routingKeys: string[];
  handler: ConsumerHandler;
}): Promise<() => Promise<void>> {
  if (!input.url) {
    return async () => undefined;
  }

  const connection = await amqp.connect(input.url);
  const channel = await connection.createChannel();
  await channel.assertExchange(rabbitExchange, 'topic', { durable: true });
  await channel.assertExchange(rabbitDeadLetterExchange, 'topic', { durable: true });
  const deadLetterQueue = `${input.queue}.dlq`;
  await channel.assertQueue(deadLetterQueue, { durable: true });
  await channel.bindQueue(deadLetterQueue, rabbitDeadLetterExchange, '#');
  await channel.assertQueue(input.queue, {
    durable: true,
    arguments: { 'x-dead-letter-exchange': rabbitDeadLetterExchange },
  });
  for (const key of input.routingKeys) {
    await channel.bindQueue(input.queue, rabbitExchange, key);
  }

  await channel.consume(input.queue, async (message) => {
    if (!message) return;
    try {
      const event = eventEnvelopeSchema.parse(JSON.parse(message.content.toString()));
      await input.handler(event, message);
      channel.ack(message);
    } catch (error) {
      channel.nack(message, false, false);
      // A DLX policy can route rejected messages to the configured dead-letter queue.
      // The consumer deliberately does not retry forever.
      console.error(`[${input.queue}] message rejected`, error);
    }
  });

  return async () => {
    await channel.close();
    await connection.close();
  };
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${String(value)}`);
}
