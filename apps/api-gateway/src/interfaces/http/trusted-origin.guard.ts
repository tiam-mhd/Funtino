import { CanActivate, ForbiddenException, Injectable, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

const DEFAULT_ORIGINS = ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002'];

@Injectable()
export class TrustedOriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const rawOrigin = request.headers.origin;
    if (typeof rawOrigin !== 'string')
      throw new ForbiddenException('A trusted browser origin is required.');

    let origin: string;
    try {
      const parsed = new URL(rawOrigin);
      if (parsed.origin !== rawOrigin || !['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Invalid origin.');
      }
      origin = parsed.origin;
    } catch {
      throw new ForbiddenException('A trusted browser origin is required.');
    }

    const configured = process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(',')
          .map((value) => value.trim())
          .filter(Boolean)
      : DEFAULT_ORIGINS;
    if (!configured.includes(origin))
      throw new ForbiddenException('Browser origin is not trusted.');
    return true;
  }
}
