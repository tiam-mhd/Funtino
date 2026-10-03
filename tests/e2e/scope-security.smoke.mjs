import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const entry = path.join(root, 'apps/api-gateway/dist/main.js');

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve an API port.');
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function waitUntilReady(child, baseUrl) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('API Gateway exited before becoming ready.');
    try {
      const response = await fetch(baseUrl + '/health/live', {
        signal: AbortSignal.timeout(1_500),
      });
      if (response.ok) return;
    } catch {
      // Retry while the local process starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('API Gateway did not become ready within 30 seconds.');
}

const port = await availablePort();
const baseUrl = 'http://127.0.0.1:' + port;
const childEnvironment = {
  ...process.env,
  API_PORT: String(port),
  NODE_ENV: 'test',
  STORAGE_MODE: 'memory',
};
for (const key of Object.keys(childEnvironment)) {
  if (/TOKEN|SECRET|PASSWORD|DATABASE_URL|PARSGREEN|RABBITMQ|REDIS_URL/i.test(key)) {
    delete childEnvironment[key];
  }
}
Object.assign(childEnvironment, {
  API_PORT: String(port),
  NODE_ENV: 'test',
  STORAGE_MODE: 'memory',
  APP_VERSION: 'e2e',
  CORS_ORIGINS: 'http://127.0.0.1:3000,http://127.0.0.1:3001,http://127.0.0.1:3002',
});

const child = spawn(process.execPath, [entry], {
  cwd: root,
  env: childEnvironment,
  stdio: 'ignore',
  windowsHide: true,
});

try {
  await waitUntilReady(child, baseUrl);

  const health = await fetch(baseUrl + '/health/live', {
    headers: { 'x-request-id': 'scope-smoke-' + crypto.randomUUID() },
  });
  assert.equal(health.status, 200, 'liveness should be public');
  for (const header of ['x-content-type-options', 'x-frame-options', 'referrer-policy']) {
    assert.ok(health.headers.get(header), 'expected security header ' + header);
  }
  assert.ok(health.headers.get('x-request-id'), 'response must include a request ID');
  assert.ok(health.headers.get('x-correlation-id'), 'response must include a correlation ID');

  const organizationId = '88888888-8888-4888-8888-888888888888';
  const protectedRequests = [
    ['GET', '/api/v1/customer/cards'],
    ['GET', '/api/v1/operations/scopes'],
    ['GET', '/api/v1/operations/devices'],
    [
      'GET',
      '/api/v1/operations/reports?scopeType=organization&organizationId=' +
        organizationId +
        '&from=2026-01-01&to=2026-01-02',
    ],
    ['GET', '/api/v1/system/organizations'],
    ['GET', '/api/v1/system/health'],
    [
      'POST',
      '/api/v1/system/organizations',
      {
        headers: {
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify({ name: 'Unauthenticated scope probe' }),
      },
    ],
  ];

  for (const [method, route, options = {}] of protectedRequests) {
    const response = await fetch(baseUrl + route, {
      method,
      ...options,
      headers: {
        ...options.headers,
        'x-request-id': 'scope-smoke-' + crypto.randomUUID(),
      },
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(
      response.status,
      401,
      method + ' ' + route + ' must fail closed without a session',
    );
  }

  const metrics = await fetch(baseUrl + '/internal/metrics');
  assert.equal(metrics.status, 404, 'internal metrics must not be exposed without a metrics token');
  process.stdout.write(
    'Scope/security E2E passed: health headers, request context, and 7 protected requests.\n',
  );
} finally {
  child.kill('SIGTERM');
  await Promise.race([
    once(child, 'exit').catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}
