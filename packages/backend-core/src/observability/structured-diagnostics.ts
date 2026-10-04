import { AsyncLocalStorage } from 'node:async_hooks';
import {
  HttpException,
  type ArgumentsHost,
  type CallHandler,
  type ExecutionContext,
  type INestApplication,
  type NestInterceptor,
} from '@nestjs/common';
import { catchError, Observable, throwError, type Subscription } from 'rxjs';

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
type HeaderValue = string | string[] | undefined;

interface DiagnosticRequest {
  method?: string;
  headers?: Record<string, HeaderValue>;
  requestId?: string;
  correlationId?: string;
  routeOptions?: { url?: string };
}

interface DiagnosticWebSocketClient {
  id?: unknown;
  handshake?: { headers?: Record<string, HeaderValue> };
}

interface StructuredLogInput {
  level: LogLevel;
  event: string;
  service: string;
  [key: string]: unknown;
}

interface ActiveRequestContext {
  service: string;
  requestId: string;
  correlationId: string;
}

interface ErrorLike {
  name?: unknown;
  code?: unknown;
  stack?: unknown;
  status?: unknown;
  cause?: unknown;
  meta?: unknown;
  modelName?: unknown;
  table?: unknown;
  issues?: unknown;
  error?: unknown;
  getResponse?: () => unknown;
}

interface FetchDiagnosticState {
  service: string;
  originalFetch: typeof fetch;
  wrappedFetch?: typeof fetch;
}

const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const SAFE_NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/;
const SAFE_CODE = /^[A-Z][A-Z0-9_.-]{0,63}$/;
const SAFE_FIELD = /^[A-Za-z][A-Za-z0-9_.$-]{0,159}$/;
const FETCH_STATE_KEY = '__funtinoStructuredFetchDiagnostics__';
const requestContext = new AsyncLocalStorage<ActiveRequestContext>();
type InstrumentedFetch = typeof fetch & { [FETCH_STATE_KEY]?: FetchDiagnosticState };
let uncaughtExceptionMonitorInstalled = false;

/**
 * Install once per backend process. The wrapper observes Node's built-in fetch
 * without recording bodies, query strings, credentials, or arbitrary headers.
 */
export function installDependencyFetchDiagnostics(service: string): void {
  installUncaughtExceptionDiagnostics(service);
  const currentFetch = globalThis.fetch as InstrumentedFetch;
  const existingState = currentFetch[FETCH_STATE_KEY];
  if (existingState) {
    existingState.service = service;
    return;
  }

  const state: FetchDiagnosticState = {
    service,
    originalFetch: globalThis.fetch.bind(globalThis),
  };
  const wrappedFetch: typeof fetch = async (input, init) => {
    const startedAt = process.hrtime.bigint();
    const target = resolveTarget(input);
    const method = safeMethod(init?.method ?? (input instanceof Request ? input.method : 'GET'));
    const origin = captureCallSite();
    const parentContext = requestContext.getStore();
    let requestId = randomId();
    let correlationId = requestId;

    try {
      const headers = new Headers(input instanceof Request ? input.headers : undefined);
      if (init?.headers) {
        new Headers(init.headers).forEach((value, name) => headers.set(name, value));
      }

      const incomingCorrelationId = safeId(headers.get('x-correlation-id') ?? undefined);
      const incomingRequestId = safeId(headers.get('x-request-id') ?? undefined);
      requestId = incomingRequestId ?? randomId();
      correlationId =
        incomingCorrelationId ?? parentContext?.correlationId ?? incomingRequestId ?? requestId;

      if (isInternalTarget(target)) {
        headers.set('x-request-id', requestId);
        headers.set('x-correlation-id', correlationId);
      } else {
        headers.delete('x-request-id');
        headers.delete('x-correlation-id');
      }

      const response = await state.originalFetch(input, { ...init, headers });
      const durationMs = elapsedMilliseconds(startedAt);
      writeStructuredLog({
        level: response.status >= 500 ? 'error' : response.status >= 400 ? 'warn' : 'info',
        event: 'dependency.http.completed',
        service: state.service,
        component: 'global.fetch',
        stage: 'http_response',
        outcome: response.ok ? 'success' : 'http_error',
        requestId,
        correlationId,
        ...(parentContext ? { parentRequestId: parentContext.requestId } : {}),
        method,
        ...(target ? { dependencyHost: target.hostname, dependencyPort: effectivePort(target) } : {}),
        status: response.status,
        durationMs,
        ...(origin.length ? { origin } : {}),
      });
      instrumentResponseJson(response, {
        service: state.service,
        requestId,
        correlationId,
        parentRequestId: parentContext?.requestId,
        method,
        target,
        status: response.status,
      });
      return response;
    } catch (error) {
      writeStructuredLog({
        level: 'error',
        event: 'dependency.http.failed',
        service: state.service,
        component: 'global.fetch',
        stage: 'request_or_transport',
        outcome: 'network_error',
        requestId,
        correlationId,
        ...(parentContext ? { parentRequestId: parentContext.requestId } : {}),
        method,
        ...(target ? { dependencyHost: target.hostname, dependencyPort: effectivePort(target) } : {}),
        durationMs: elapsedMilliseconds(startedAt),
        error: createSafeErrorDiagnostic(error),
        ...(origin.length ? { origin } : {}),
      });
      throw error;
    }
  };

  state.wrappedFetch = wrappedFetch;
  Object.defineProperty(wrappedFetch, FETCH_STATE_KEY, { value: state });
  globalThis.fetch = wrappedFetch;
}

export function installUncaughtExceptionDiagnostics(service: string): void {
  installUncaughtExceptionMonitor(service);
}

function installUncaughtExceptionMonitor(service: string): void {
  if (uncaughtExceptionMonitorInstalled) return;
  uncaughtExceptionMonitorInstalled = true;
  process.on('uncaughtExceptionMonitor', (error, origin) => {
    writeStructuredLog({
      level: 'fatal',
      event: 'process.uncaught_exception',
      service,
      component: 'node:process',
      stage:
        typeof origin === 'string' && origin === 'unhandledRejection'
          ? 'unhandled_rejection'
          : 'uncaught_exception',
      error: createSafeErrorDiagnostic(error),
    });
  });
}

export function createSafeErrorDiagnostic(error: unknown): Record<string, unknown> {
  const root = asErrorLike(error);
  const rootMetadata = safeErrorMetadata(root);
  const causes: Record<string, unknown>[] = [];
  const seen = new Set<unknown>([error]);
  let current = root.cause;

  for (let depth = 0; current !== undefined && depth < 5 && !seen.has(current); depth += 1) {
    seen.add(current);
    const cause = asErrorLike(current);
    causes.push(safeErrorMetadata(cause));
    current = cause.cause;
  }

  const issues = Array.isArray(root.issues) ? root.issues : undefined;
  const issueCodes = issues
    ?.map((issue) => safeValidationCode(asErrorLike(issue).code))
    .filter((code): code is string => code !== undefined)
    .slice(0, 8);
  const frames = safeFrames(root.stack);

  return {
    ...rootMetadata,
    ...(issues ? { validationIssueCount: issues.length } : {}),
    ...(issueCodes?.length ? { validationIssueCodes: issueCodes } : {}),
    ...(causes.length ? { causes } : {}),
    ...(frames.length ? { frames } : {}),
  };
}

export function writeStructuredLog(input: StructuredLogInput): void {
  const { level, event, service, ...fields } = input;
  const currentContext = requestContext.getStore();
  const explicitOrigin = Array.isArray(fields.origin) ? fields.origin : undefined;
  const hasExplicitOrigin = explicitOrigin !== undefined;
  const origin = explicitOrigin ?? captureCallSite();
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event: safeContext(event),
    service: safeContext(service),
    environment: safeContext(process.env.NODE_ENV ?? 'development'),
    version: safeContext(process.env.APP_VERSION ?? 'dev'),
    ...(currentContext
      ? {
          requestId: currentContext.requestId,
          correlationId: currentContext.correlationId,
        }
      : {}),
    ...(!hasExplicitOrigin && origin.length ? { origin } : {}),
    ...fields,
  };

  try {
    process.stdout.write(`${JSON.stringify(entry)}\n`);
  } catch {
    process.stdout.write(
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error',
        event: 'diagnostic.log_serialization_failed',
        service: safeContext(service),
      })}\n`,
    );
  }
}

export function logHttpRequestException(input: {
  service: string;
  component: string;
  exception: unknown;
  request?: DiagnosticRequest;
}): void {
  const request = input.request;
  const status = exceptionStatus(input.exception);
  const route = safeRoute(request?.routeOptions?.url);
  const method = safeMethod(request?.method);

  writeStructuredLog({
    level: status >= 500 ? 'error' : 'warn',
    event: 'http.request.exception',
    service: input.service,
    component: safeContext(input.component),
    stage: 'http_exception_pipeline',
    requestId: safeId(request?.requestId ?? firstHeader(request?.headers?.['x-request-id'])),
    correlationId: safeId(
      request?.correlationId ?? firstHeader(request?.headers?.['x-correlation-id']),
    ),
    method,
    route,
    status,
    error: createSafeErrorDiagnostic(input.exception),
  });
}

/** Add structured diagnostics while preserving Nest's regular HTTP error body. */
export function installHttpExceptionDiagnostics(
  application: INestApplication,
  service: string,
): void {
  application.useGlobalInterceptors(new HttpExceptionDiagnosticInterceptor(service, true));
}

/** Establishes request/correlation context without duplicating a custom exception filter's log. */
export function installHttpRequestContext(application: INestApplication, service: string): void {
  application.useGlobalInterceptors(new HttpExceptionDiagnosticInterceptor(service, false));
}

class HttpExceptionDiagnosticInterceptor implements NestInterceptor {
  constructor(
    private readonly service: string,
    private readonly logExceptions: boolean,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const contextType = String(context.getType());
    if (contextType === 'http') {
      const request = context.switchToHttp().getRequest<DiagnosticRequest>();
      const requestId =
        safeId(request.requestId ?? firstHeader(request.headers?.['x-request-id'])) ?? randomId();
      const correlationId =
        safeId(request.correlationId ?? firstHeader(request.headers?.['x-correlation-id'])) ??
        requestId;
      return this.runWithContext(
        next,
        { service: this.service, requestId, correlationId },
        (exception) =>
          logHttpRequestException({
            service: this.service,
            component: 'HttpExceptionDiagnosticInterceptor',
            exception,
            request,
          }),
      );
    }

    if (contextType === 'ws') {
      const client = context.switchToWs().getClient<DiagnosticWebSocketClient>();
      const headers = client.handshake?.headers;
      const requestId = safeId(firstHeader(headers?.['x-request-id'])) ?? randomId();
      const correlationId = safeId(firstHeader(headers?.['x-correlation-id'])) ?? requestId;
      return this.runWithContext(
        next,
        { service: this.service, requestId, correlationId },
        this.logExceptions
          ? (exception) =>
              writeStructuredLog({
                level: 'error',
                event: 'transport.request.exception',
                service: this.service,
                component: 'HttpExceptionDiagnosticInterceptor',
                transport: 'websocket',
                stage: 'message_handler',
                requestId,
                correlationId,
                ...(safeId(typeof client.id === 'string' ? client.id : undefined)
                  ? { connectionId: client.id }
                  : {}),
                error: createSafeErrorDiagnostic(exception),
              })
          : undefined,
      );
    }

    return next.handle();
  }

  private runWithContext(
    next: CallHandler,
    activeContext: ActiveRequestContext,
    onException?: (exception: unknown) => void,
  ): Observable<unknown> {
    return new Observable((subscriber) => {
      let subscription: Subscription | undefined;
      requestContext.run(activeContext, () => {
        const stream = next.handle();
        subscription = (
          onException
            ? stream.pipe(
                catchError((exception: unknown) => {
                  onException(exception);
                  return throwError(() => exception);
                }),
              )
            : stream
        ).subscribe(subscriber);
      });
      return () => subscription?.unsubscribe();
    });
  }
}

function safeErrorMetadata(error: ErrorLike): Record<string, unknown> {
  const name = typeof error.name === 'string' && SAFE_NAME.test(error.name) ? error.name : 'UnknownError';
  const code = safeCode(error.code);
  const meta = asErrorLike(error.meta);
  const metaCode = safeCode(meta.code);
  const sqlState =
    typeof meta.code === 'string' && /^[0-9A-Z]{5}$/.test(meta.code) ? meta.code : undefined;
  const modelName = safeField(meta.modelName);
  const table = safeField(meta.table);
  const responseCode = errorResponseCode(error);

  return {
    type: name,
    ...(code ? { code } : {}),
    ...(!code && responseCode ? { code: responseCode } : {}),
    ...(metaCode ? { metaCode } : {}),
    ...(sqlState ? { sqlState } : {}),
    ...(modelName ? { modelName } : {}),
    ...(table ? { table } : {}),
  };
}

function errorResponseCode(error: ErrorLike): string | undefined {
  if (typeof error.getResponse !== 'function') return undefined;
  try {
    const response = asErrorLike(error.getResponse());
    const nestedError = asErrorLike(response.error);
    return safeCode(nestedError.code) ?? safeCode(response.code);
  } catch {
    return undefined;
  }
}

function exceptionStatus(error: unknown): number {
  if (error instanceof HttpException) return error.getStatus();
  const candidate = asErrorLike(error);
  const status = candidate.status;
  return typeof status === 'number' && status >= 400 && status <= 599 ? status : 500;
}

function asErrorLike(value: unknown): ErrorLike {
  if (typeof value !== 'object' || value === null) return {};
  return value as ErrorLike;
}

function safeFrames(stack: unknown): string[] {
  if (typeof stack !== 'string') return [];
  return stack
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('at '))
    .filter((line) => !line.includes('node:internal') && !line.includes('node_modules'))
    .map((line) => line.replace(/\s+/g, ' ').slice(0, 240))
    .slice(0, 6);
}

function captureCallSite(): string[] {
  return (new Error().stack ?? '')
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('at '))
    .filter(
      (line) =>
        !line.includes('node:internal') &&
        !line.includes('node_modules') &&
        !line.includes('installDependencyFetchDiagnostics') &&
        !line.includes('wrappedFetch') &&
        !line.includes('writeStructuredLog') &&
        !line.includes('captureCallSite'),
    )
    .map((line) => line.replace(/\s+/g, ' ').slice(0, 240))
    .slice(0, 6);
}

function resolveTarget(input: RequestInfo | URL): URL | undefined {
  try {
    if (input instanceof URL) return input;
    if (input instanceof Request) return new URL(input.url);
    return new URL(input);
  } catch {
    return undefined;
  }
}

function isInternalTarget(target: URL | undefined): boolean {
  if (!target) return false;
  const hostname = target.hostname.toLowerCase();
  const ipv4 = hostname.split('.').map(Number);
  const privateIpv4 =
    ipv4.length === 4 &&
    ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
    (ipv4[0] === 10 ||
      (ipv4[0] === 172 && ipv4[1]! >= 16 && ipv4[1]! <= 31) ||
      (ipv4[0] === 192 && ipv4[1] === 168) ||
      ipv4[0] === 127);
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.endsWith('.internal') ||
    hostname.includes('.internal.') ||
    (!hostname.includes('.') && !/^\d/.test(hostname)) ||
    privateIpv4 ||
    hostname === 'api.funtino.ir' ||
    hostname.endsWith('.svc.cluster.local')
  );
}

function effectivePort(target: URL): string {
  return target.port || (target.protocol === 'https:' ? '443' : '80');
}

function elapsedMilliseconds(startedAt: bigint): number {
  const value = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  return Math.round(value * 100) / 100;
}

function safeContext(value: string): string {
  return /^[A-Za-z0-9_.-]{1,120}$/.test(value) ? value : 'unknown';
}

function safeField(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_FIELD.test(value) ? value : undefined;
}

function safeCode(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_CODE.test(value) ? value : undefined;
}

function safeValidationCode(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-z][a-z0-9_.-]{0,63}$/i.test(value)
    ? value
    : undefined;
}

function instrumentResponseJson(
  response: Response,
  context: {
    service: string;
    requestId: string;
    correlationId: string;
    parentRequestId?: string;
    method: string;
    target?: URL;
    status: number;
  },
): void {
  const originalJson = response.json.bind(response);
  try {
    Object.defineProperty(response, 'json', {
      configurable: true,
      value: async () => {
        try {
          return await originalJson();
        } catch (error) {
          const origin = captureCallSite();
          writeStructuredLog({
            level: 'error',
            event: 'dependency.response.json_failed',
            service: context.service,
            component: 'global.fetch',
            stage: 'response_json_parse',
            outcome: 'invalid_json',
            requestId: context.requestId,
            correlationId: context.correlationId,
            ...(context.parentRequestId ? { parentRequestId: context.parentRequestId } : {}),
            method: context.method,
            ...(context.target
              ? {
                  dependencyHost: context.target.hostname,
                  dependencyPort: effectivePort(context.target),
                }
              : {}),
            status: context.status,
            error: createSafeErrorDiagnostic(error),
            ...(origin.length ? { origin } : {}),
          });
          throw error;
        }
      },
    });
  } catch {
    // Instrumentation must never change fetch behavior if a Response is non-extensible.
  }
}

function safeId(value: string | undefined): string | undefined {
  return value && SAFE_ID.test(value) ? value : undefined;
}

function safeMethod(value: unknown): string {
  return typeof value === 'string' && /^[A-Z]{1,12}$/i.test(value)
    ? value.toUpperCase()
    : 'OTHER';
}

function safeRoute(value: string | undefined): string {
  return value && value.length <= 200 && value.startsWith('/') && !value.includes('?')
    ? value
    : 'unmatched';
}

function firstHeader(value: HeaderValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function randomId(): string {
  return crypto.randomUUID();
}
