import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import { consumeRabbitQueue } from '@funtino/backend-core';
import { eventTypes, type EventEnvelope } from '@funtino/event-contracts';

type AuthenticatedSocket = Socket & { userId?: string };

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

  private readonly logger = new Logger(RealtimeGateway.name);
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
    @MessageBody() body: { channel?: string },
    @ConnectedSocket() socket: AuthenticatedSocket,
  ): Promise<{ ok: boolean; channel?: string }> {
    if (body?.channel !== 'me' || !socket.userId) return { ok: false };
    await socket.join(`user:${socket.userId}`);
    return { ok: true, channel: 'me' };
  }

  private async authorize(socket: AuthenticatedSocket, sessionToken: string): Promise<boolean> {
    const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:4000';
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/auth/me`, {
        headers: { cookie: `funtino_session=${encodeURIComponent(sessionToken)}` },
      });
      if (!response.ok) return false;
      const body = (await response.json()) as { data?: { id?: string } };
      if (!body.data?.id) return false;
      socket.userId = body.data.id;
      return true;
    } catch (error) {
      this.logger.warn(`realtime auth unavailable: ${String(error)}`);
      return false;
    }
  }

  private broadcast(event: EventEnvelope): void {
    const userId = typeof event.payload.userId === 'string' ? event.payload.userId : undefined;
    if (userId) this.server.to(`user:${userId}`).emit('domain:event', event);
    this.logger.debug(`projected ${event.eventType}`);
  }
}
