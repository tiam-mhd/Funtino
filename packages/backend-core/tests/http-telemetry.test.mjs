import assert from 'node:assert/strict';
import test from 'node:test';
const telemetryModule = process.env.FUNTINO_TELEMETRY_TEST_SOURCE
  ? await import('../src/observability/http-telemetry.ts')
  : await import('../dist/observability/http-telemetry.js');
const { installHttpTelemetry } = telemetryModule;

function harness() {
  const hooks = {};
  let metricsHandler;
  const server = {
    addHook(name, handler) {
      hooks[name] = handler;
    },
    route(options) {
      metricsHandler = options.handler;
    },
  };
  const logs = [];
  const previousWrite = process.stdout.write;
  const previousToken = process.env.TEST_METRICS_TOKEN;
  process.stdout.write = function (chunk) {
    logs.push(String(chunk));
    return true;
  };
  installHttpTelemetry(server, {
    service: 'test-service',
    tokenEnvironmentVariable: 'TEST_METRICS_TOKEN',
  });
  return {
    hooks,
    logs,
    async restore() {
      process.stdout.write = previousWrite;
      if (previousToken === undefined) delete process.env.TEST_METRICS_TOKEN;
      else process.env.TEST_METRICS_TOKEN = previousToken;
    },
    metricsHandler,
  };
}

test('telemetry records only low-cardinality route data and does not leak query or headers', async () => {
  delete process.env.TEST_METRICS_TOKEN;
  const h = harness();
  try {
    const request = {
      method: 'GET',
      url: '/api/v1/cards?phone=private',
      routeOptions: { url: '/api/v1/cards' },
      headers: {
        authorization: 'Bearer private',
        cookie: 'session=private',
        'x-request-id': 'request-1',
      },
    };
    const reply = { statusCode: 200, header() {} };
    await new Promise((resolve) => h.hooks.onRequest(request, reply, resolve));
    await new Promise((resolve) => setTimeout(resolve, 1));
    await new Promise((resolve) => h.hooks.onResponse(request, reply, resolve));
    const entryLine = h.logs.find((chunk) => chunk.trimStart().startsWith('{'));
    assert.ok(entryLine, 'telemetry must emit one JSON log record');
    const entry = JSON.parse(entryLine);
    assert.equal(entry.route, '/api/v1/cards');
    assert.equal(entry.requestId, 'request-1');
    assert.equal(JSON.stringify(entry).includes('private'), false);
  } finally {
    await h.restore();
  }
});

test('metrics route is hidden without a configured token and requires constant-time bearer match', async () => {
  delete process.env.TEST_METRICS_TOKEN;
  const h = harness();
  try {
    let status = 200;
    const reply = {
      header() {
        return this;
      },
      code(value) {
        status = value;
        return this;
      },
      send() {},
    };
    await h.metricsHandler({ headers: {} }, reply);
    assert.equal(status, 404);
  } finally {
    await h.restore();
  }

  process.env.TEST_METRICS_TOKEN = 'a'.repeat(32);
  const secured = harness();
  try {
    let status = 200;
    let body = '';
    const reply = {
      code(value) {
        status = value;
        return this;
      },
      header() {
        return this;
      },
      send(value) {
        body = value;
      },
    };
    const request = { method: 'GET', routeOptions: { url: '/health/live' }, headers: {} };
    await new Promise((resolve) => secured.hooks.onRequest(request, reply, resolve));
    await new Promise((resolve) => secured.hooks.onResponse(request, reply, resolve));
    await secured.metricsHandler({ headers: { authorization: 'Bearer ' + 'a'.repeat(32) } }, reply);
    assert.equal(status, 200);
    assert.match(body, /funtino_http_server_requests_total/);
    assert.match(body, /# TYPE funtino_http_server_request_duration_seconds histogram/);
    assert.match(body, /funtino_http_server_request_duration_seconds_bucket\{[^\n]*le="\+Inf"\} 1/);
  } finally {
    await secured.restore();
  }
});

test('production startup fails closed when the metrics credential is missing or too short', () => {
  const previousToken = process.env.TEST_METRICS_TOKEN;
  const previousEnvironment = process.env.NODE_ENV;
  delete process.env.TEST_METRICS_TOKEN;
  process.env.NODE_ENV = 'production';
  try {
    assert.throws(
      () =>
        installHttpTelemetry(
          {},
          {
            service: 'test-service',
            tokenEnvironmentVariable: 'TEST_METRICS_TOKEN',
          },
        ),
      /required in production/,
    );
    process.env.TEST_METRICS_TOKEN = 'too-short';
    assert.throws(
      () =>
        installHttpTelemetry(
          {},
          {
            service: 'test-service',
            tokenEnvironmentVariable: 'TEST_METRICS_TOKEN',
          },
        ),
      /at least 32 characters/,
    );
  } finally {
    if (previousToken === undefined) delete process.env.TEST_METRICS_TOKEN;
    else process.env.TEST_METRICS_TOKEN = previousToken;
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;
  }
});
