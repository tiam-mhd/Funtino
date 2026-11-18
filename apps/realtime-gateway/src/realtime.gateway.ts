import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import {
  consumeRabbitQueue,
  createSafeErrorDiagnostic,
  normalizeCorrelationId,
  writeStructuredLog,
} from '@funtino/backend-core';
import { eventTypes, type EventEnvelope } from '@funtino/event-contracts';
import { randomUUID } from 'node:crypto';

type AuthenticatedSocket = Socket & { userId?: string; householdIds?: string[] };

@WebSocketGateway({
  namespace: '/realtime',
  cors: {
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(','),
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayConnection, OnModuleInit, OnModuleDestroy {
  @WebSocketServer()
  server!: Server;

  private stopConsumer?: () => Promise<void>;

  async onModuleInit(): Promise<void> {
    this.stopConsumer = await consumeRabbitQueue({
      url: process.env.RABBITMQ_URL,
      queue: 'funtino.realtime-gateway.v1',
      routingKeys: Object.values(eventTypes),
      handler: async (event) => this.broadcast(event),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.stopConsumer?.();
  }

  async handleConnection(socket: AuthenticatedSocket): Promise<void> {
    const sessionToken = socket.handshake.auth?.sessionToken;
    if (typeof sessionToken !== 'string' || !(await this.authorize(socket, sessionToken))) {
      socket.emit('realtime:error', { code: 'UNAUTHENTICATED' });
      socket.disconnect(true);
      return;
    }
    await socket.join(`user:${socket.userId}`);
    socket.emit('realtime:ready', { userId: socket.userId });
  }

  @SubscribeMessage('subscribe')
  async subscribe(
    @MessageBody() body: { channel?: string; householdId?: string },
    @ConnectedSocket() socket: AuthenticatedSocket,
  ): Promise<{ ok: boolean; channel?: string }> {
    if (!socket.userId) return { ok: false };
    if (body?.channel === 'me') {
      await socket.join(`user:${socket.userId}`);
      return { ok: true, channel: 'me' };
    }
    const householdId = body?.householdId;
    if (!isUuid(householdId) || !socket.householdIds?.includes(householdId.toLowerCase()))
      return { ok: false };
    await socket.join(`household:${householdId.toLowerCase()}`);
    return { ok: true, channel: 'household' };
  }

  private async authorize(socket: AuthenticatedSocket, sessionToken: string): Promise<boolean> {
    const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:4000';
    const requestId = randomUUID();
    const incomingCorrelationId = socket.handshake.headers['x-correlation-id'];
    const correlationId = normalizeCorrelationId(
      Array.isArray(incomingCorrelationId) ? incomingCorrelationId[0] : incomingCorrelationId,
    );
    let failureStage = 'api_gateway_fetch';
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/auth/me`, {
        headers: {
          cookie: `funtino_session=${encodeURIComponent(sessionToken)}`,
          'x-request-id': requestId,
          'x-correlation-id': correlationId,
        },
      });
      if (!response.ok) {
        writeStructuredLog({
          level: response.status >= 500 ? 'error' : 'warn',
          event: 'realtime.auth.lookup_failed',
          service: 'realtime-gateway',
          component: 'RealtimeGateway.authorize',
          stage: 'api_gateway_http_response',
          requestId,
          correlationId,
          dependency: 'api-gateway',
          status: response.status,
        });
        return false;
      }
      failureStage = 'api_gateway_response_json';
      const body = (await response.json()) as { data?: { id?: unknown } };
      failureStage = 'api_gateway_response_validation';
      if (typeof body.data?.id !== 'string') {
        writeStructuredLog({
          level: 'error',
          event: 'realtime.auth.lookup_failed',
          service: 'realtime-gateway',
          component: 'RealtimeGateway.authorize',
          stage: failureStage,
          requestId,
          correlationId,
          dependency: 'api-gateway',
          error: { type: 'ResponseContractError', code: 'AUTH_RESPONSE_INVALID' },
        });
        return false;
      }
      socket.userId = body.data.id;
      failureStage = 'api_gateway_households_fetch';
      const householdResponse = await fetch(`${apiBaseUrl}/api/v1/customer/households`, {
        headers: {
          cookie: `funtino_session=${encodeURIComponent(sessionToken)}`,
          'x-request-id': requestId,
          'x-correlation-id': correlationId,
        },
      });
      if (!householdResponse.ok) return false;
      const householdBody = (await householdResponse.json()) as { data?: unknown };
      if (!Array.isArray(householdBody.data)) return false;
      socket.householdIds = householdBody.data.flatMap((item) => {
        if (!item || typeof item !== 'object' || !('id' in item) || !isUuid(item.id)) return [];
        return [item.id.toLowerCase()];
      });
      return true;
    } catch (error) {
      writeStructuredLog({
        level: 'error',
        event: 'realtime.auth.lookup_failed',
        service: 'realtime-gateway',
        component: 'RealtimeGateway.authorize',
        stage: failureStage,
        requestId,
        correlationId,
        dependency: 'api-gateway',
        error: createSafeErrorDiagnostic(error),
      });
      return false;
    }
  }

  private broadcast(event: EventEnvelope): void {
    const userId = typeof event.payload.userId === 'string' ? event.payload.userId : undefined;
    if (userId) this.server.to(`user:${userId}`).emit('domain:event', event);
    if (
      event.eventType === eventTypes.walletCardLedgerEntryCreatedV2 ||
      event.eventType === eventTypes.walletCardLifecycleChanged
    ) {
      const householdId = event.payload.householdId;
      if (isUuid(householdId)) {
        this.server.to(`household:${householdId.toLowerCase()}`).emit('invalidate', {
          type: event.eventType === eventTypes.walletCardLifecycleChanged ? 'card-lifecycle' : 'card-ledger',
          householdId: householdId.toLowerCase(),
        });
      }
    }
    if (event.eventType === eventTypes.walletCardAssignmentChanged) {
      for (const key of ['householdId', 'previousHouseholdId']) {
        const householdId = event.payload[key];
        if (isUuid(householdId)) {
          this.server.to(`household:${householdId.toLowerCase()}`).emit('invalidate', {
            type: 'card-assignment',
            householdId: householdId.toLowerCase(),
          });
        }
      }
    }
    writeStructuredLog({
      level: 'debug',
      event: 'realtime.event.projected',
      service: 'realtime-gateway',
      component: 'RealtimeGateway.broadcast',
      eventType: event.eventType,
    });
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}
