import { timingSafeEqual, randomUUID } from 'node:crypto';
import { installDependencyFetchDiagnostics } from './structured-diagnostics.js';

type HeaderValue = string | string[] | undefined;
type TelemetryRequest = {
  method: string;
  url: string;
  headers: Record<string, HeaderValue>;
  routeOptions?: { url?: string };
  requestId?: string;
  correlationId?: string;
  telemetryStartedAt?: bigint;
};
type TelemetryReply = {
  statusCode: number;
  header(name: string, value: string): TelemetryReply;
  send(body: string): unknown;
};
type TelemetryServer = {
  addHook(
    name: 'onRequest',
    handler: (request: TelemetryRequest, reply: TelemetryReply, done: () => void) => void,
  ): void;
  addHook(
    name: 'onResponse',
    handler: (request: TelemetryRequest, reply: TelemetryReply, done: () => void) => void,
  ): void;
  route(options: {
    method: 'GET';
    url: string;
    handler: (
      request: TelemetryRequest,
      reply: TelemetryReply & { code(status: number): TelemetryReply },
    ) => unknown;
  }): void;
};

export interface HttpTelemetryOptions {
  service: string;
  tokenEnvironmentVariable: string;
}

interface Metric {
  count: number;
  durationMs: number;
  durationSecondsBuckets: number[];
}

const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const REQUEST_DURATION_BUCKETS_SECONDS = [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, Infinity];

export function installHttpTelemetry(server: unknown, options: HttpTelemetryOptions): void {
  const app = server as TelemetryServer;
  const token = process.env[options.tokenEnvironmentVariable];
  if (token && token.length < 32) {
    throw new Error(options.tokenEnvironmentVariable + ' must contain at least 32 characters.');
  }
  if (process.env.NODE_ENV === 'production' && (!token || token.length < 32)) {
    throw new Error(options.tokenEnvironmentVariable + ' is required in production.');
  }

  installDependencyFetchDiagnostics(options.service);

  const metrics = new Map<string, Metric>();
  app.addHook('onRequest', (request, reply, done) => {
    request.telemetryStartedAt = process.hrtime.bigint();
    request.requestId =
      safeId(request.requestId ?? header(request.headers['x-request-id'])) ?? randomUUID();
    request.correlationId =
      safeId(request.correlationId ?? header(request.headers['x-correlation-id'])) ??
      request.requestId;
    reply.header('x-request-id', request.requestId);
    reply.header('x-correlation-id', request.correlationId);
    done();
  });

  app.addHook('onResponse', (request, reply, done) => {
    const route = safeRoute(request.routeOptions?.url);
    const method = /^[A-Z]{1,12}$/.test(request.method) ? request.method : 'OTHER';
    const status = Number.isInteger(reply.statusCode) ? reply.statusCode : 0;
    const durationMs = request.telemetryStartedAt
      ? Number(process.hrtime.bigint() - request.telemetryStartedAt) / 1_000_000
      : 0;
    const key = [method, route, status].join('|');
    const metric = metrics.get(key) ?? {
      count: 0,
      durationMs: 0,
      durationSecondsBuckets: REQUEST_DURATION_BUCKETS_SECONDS.map(() => 0),
    };
    metric.count += 1;
    metric.durationMs += durationMs;
    const durationSeconds = durationMs / 1_000;
    REQUEST_DURATION_BUCKETS_SECONDS.forEach((upperBound, index) => {
      if (durationSeconds <= upperBound) metric.durationSecondsBuckets[index]! += 1;
    });
    metrics.set(key, metric);
    process.stdout.write(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        event: 'http.request.complete',
        service: options.service,
        environment: process.env.NODE_ENV ?? 'development',
        version: process.env.APP_VERSION ?? 'dev',
        requestId: request.requestId,
        correlationId: request.correlationId,
        method,
        route,
        status,
        durationMs: Math.round(durationMs * 100) / 100,
      }) + '\n',
    );
    done();
  });

  app.route({
    method: 'GET',
    url: '/internal/metrics',
    handler: (request, reply) => {
      reply.header('cache-control', 'no-store');
      if (!token || !constantTimeBearerMatch(header(request.headers.authorization), token)) {
        return reply.code(404).send('not found\n');
      }
      const output = [
        '# HELP funtino_http_server_requests_total Completed HTTP requests.',
        '# TYPE funtino_http_server_requests_total counter',
        '# HELP funtino_http_server_request_duration_ms_sum Total request duration in milliseconds.',
        '# TYPE funtino_http_server_request_duration_ms_sum counter',
        '# HELP funtino_http_server_request_duration_seconds HTTP request duration in seconds.',
        '# TYPE funtino_http_server_request_duration_seconds histogram',
      ];
      for (const [key, metric] of metrics) {
        const [method, route, status] = key.split('|');
        const labels =
          'service="' +
          metricLabel(options.service) +
          '",method="' +
          metricLabel(method ?? 'OTHER') +
          '",route="' +
          metricLabel(route ?? 'unmatched') +
          '",status="' +
          metricLabel(status ?? '0') +
          '"';
        output.push('funtino_http_server_requests_total{' + labels + '} ' + metric.count);
        output.push(
          'funtino_http_server_request_duration_ms_sum{' +
            labels +
            '} ' +
            Math.round(metric.durationMs * 100) / 100,
        );
        REQUEST_DURATION_BUCKETS_SECONDS.forEach((upperBound, index) => {
          const bucketLabels =
            labels + ',le="' + (Number.isFinite(upperBound) ? upperBound : '+Inf') + '"';
          output.push(
            'funtino_http_server_request_duration_seconds_bucket{' +
              bucketLabels +
              '} ' +
              metric.durationSecondsBuckets[index],
          );
        });
        output.push(
          'funtino_http_server_request_duration_seconds_sum{' +
            labels +
            '} ' +
            Math.round((metric.durationMs / 1_000) * 1_000_000) / 1_000_000,
        );
        output.push(
          'funtino_http_server_request_duration_seconds_count{' + labels + '} ' + metric.count,
        );
      }
      return reply
        .header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
        .send(output.join('\n') + '\n');
    },
  });
}

function header(value: HeaderValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function safeId(value: string | undefined): string | undefined {
  return value && SAFE_ID.test(value) ? value : undefined;
}

function safeRoute(value: string | undefined): string {
  if (!value || value === '/internal/metrics') return 'unmatched';
  return value.length <= 200 && value.startsWith('/') && !value.includes('?') ? value : 'unmatched';
}

function metricLabel(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
}

function constantTimeBearerMatch(value: string | undefined, expected: string): boolean {
  if (!value?.startsWith('Bearer ')) return false;
  const actual = Buffer.from(value.slice(7));
  const target = Buffer.from(expected);
  return actual.length === target.length && timingSafeEqual(actual, target);
}
