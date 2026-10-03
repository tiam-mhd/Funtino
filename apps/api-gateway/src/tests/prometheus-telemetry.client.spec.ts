import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PrometheusTelemetryClient,
  PrometheusTelemetryUnavailableError,
} from '../infrastructure/observability/prometheus-telemetry.client.js';

const now = Date.parse('2026-10-01T08:00:00.000Z');

function vectorResponse(result: unknown[]) {
  return new Response(
    JSON.stringify({ status: 'success', data: { resultType: 'vector', result } }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  );
}

function sample(service: string, value: string, metric: Record<string, string> = {}) {
  return { metric: { service, ...metric }, value: [now / 1_000, value] };
}

test('system telemetry returns only allow-listed service health and fixed Prometheus queries', async () => {
  const requests: URL[] = [];
  const client = new PrometheusTelemetryClient({
    baseUrl: () => 'https://metrics.internal.example/prometheus/',
    now: () => now,
    fetcher: async (input) => {
      const url = new URL(String(input));
      requests.push(url);
      const expression = url.searchParams.get('query');
      if (expression?.startsWith('up{')) {
        return vectorResponse([
          sample('api-gateway', '1'),
          sample('api-gateway', '0', { instance: 'private-host:4000' }),
          sample('untrusted-service', '1'),
        ]);
      }
      if (expression?.startsWith('timestamp(')) {
        return vectorResponse([
          sample('api-gateway', String(now / 1_000 - 20)),
          sample('api-gateway', String(now / 1_000 - 20)),
        ]);
      }
      if (expression?.startsWith('sum by (service) (rate(funtino_http_server_requests_total')) {
        return vectorResponse([
          sample('api-gateway', expression.includes('status=') ? '0.5' : '10'),
        ]);
      }
      if (expression?.startsWith('histogram_quantile')) {
        return vectorResponse([sample('api-gateway', '0.2')]);
      }
      return vectorResponse([
        sample('api-gateway', '1', {
          alertname: 'FuntinoBackendScrapeFailed',
          severity: 'critical',
        }),
        sample('untrusted-service', '1', {
          alertname: 'FuntinoFakeAlert',
          severity: 'critical',
        }),
      ]);
    },
  });

  const result = await client.readSystemHealth();
  const gateway = result.services.find((service) => service.key === 'api-gateway');
  const unconfigured = result.services.find((service) => service.key === 'wallet');

  assert.equal(requests.length, 6);
  assert.ok(requests.every((url) => url.pathname === '/prometheus/api/v1/query'));
  assert.ok(requests.every((url) => !url.searchParams.has('service')));
  assert.equal(result.services.length, 12);
  assert.equal(gateway?.status, 'degraded');
  assert.equal(gateway?.targets, 2);
  assert.equal(gateway?.unavailableTargets, 1);
  assert.equal(gateway?.freshnessSeconds, 20);
  assert.equal(gateway?.requestsPerSecond, 10);
  assert.equal(gateway?.serverErrorPercent, 5);
  assert.equal(gateway?.p95LatencyMs, 200);
  assert.equal(gateway?.lastScrapedAt, '2026-10-01T07:59:40.000Z');
  assert.equal(unconfigured?.status, 'unknown');
  assert.deepEqual(result.activeAlerts, [
    { name: 'FuntinoBackendScrapeFailed', service: 'api-gateway', severity: 'critical' },
  ]);
  assert.equal(JSON.stringify(result).includes('private-host'), false);
});

test('telemetry source absence and malformed Prometheus responses fail closed', async () => {
  const missing = new PrometheusTelemetryClient({ baseUrl: () => undefined });
  await assert.rejects(missing.readSystemHealth(), PrometheusTelemetryUnavailableError);

  const invalid = new PrometheusTelemetryClient({
    baseUrl: () => 'https://metrics.internal.example',
    fetcher: async () => new Response('{"status":"error"}', { status: 200 }),
  });
  await assert.rejects(invalid.readSystemHealth(), PrometheusTelemetryUnavailableError);
});

test('service scrape older than the freshness budget is marked stale, not healthy', async () => {
  const client = new PrometheusTelemetryClient({
    baseUrl: () => 'https://metrics.internal.example',
    now: () => now,
    fetcher: async (input) => {
      const expression = new URL(String(input)).searchParams.get('query');
      if (expression?.startsWith('up{')) return vectorResponse([sample('api-gateway', '1')]);
      if (expression?.startsWith('timestamp(')) {
        return vectorResponse([sample('api-gateway', String(now / 1_000 - 120))]);
      }
      return vectorResponse([]);
    },
  });

  const result = await client.readSystemHealth();
  const gateway = result.services.find((service) => service.key === 'api-gateway');
  assert.equal(gateway?.status, 'stale');
  assert.equal(gateway?.freshnessSeconds, 120);
});
