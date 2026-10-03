export type SystemHealthStatus = 'healthy' | 'degraded' | 'down' | 'stale' | 'unknown';
export type SystemHealthSeverity = 'critical' | 'warning' | 'info';

export type SystemHealthService = {
  key: string;
  name: string;
  status: SystemHealthStatus;
  targets: number;
  unavailableTargets: number;
  requestsPerSecond: number | null;
  serverErrorPercent: number | null;
  p95LatencyMs: number | null;
  freshnessSeconds: number | null;
  lastScrapedAt: string | null;
};

export type SystemHealthAlert = {
  name: string;
  service: string;
  severity: SystemHealthSeverity;
};

export type SystemHealthSnapshot = {
  observedAt: string;
  source: 'prometheus';
  services: SystemHealthService[];
  activeAlerts: SystemHealthAlert[];
};

export class PrometheusTelemetryUnavailableError extends Error {
  constructor() {
    super('Operational telemetry is not configured or is temporarily unavailable.');
    this.name = 'PrometheusTelemetryUnavailableError';
  }
}

const expectedServices = [
  { key: 'api-gateway', name: 'API Gateway' },
  { key: 'realtime-gateway', name: 'Realtime Gateway' },
  { key: 'device-integration', name: 'Device Integration' },
  { key: 'wallet', name: 'Wallet' },
  { key: 'notifications', name: 'Notifications' },
  { key: 'identity-access', name: 'Identity & Access' },
  { key: 'organization-branch', name: 'Organization & Branch' },
  { key: 'analytics-read-model', name: 'Analytics Read Model' },
  { key: 'rabbitmq', name: 'RabbitMQ' },
  { key: 'prometheus', name: 'Prometheus' },
  { key: 'alertmanager', name: 'Alertmanager' },
  { key: 'grafana', name: 'Grafana' },
] as const;

const serviceKeys = new Set<string>(expectedServices.map((service) => service.key));
const serviceMatcher =
  'api-gateway|realtime-gateway|device-integration|wallet|notifications|identity-access|organization-branch|analytics-read-model';
const queries = {
  availability: 'up{job=~"funtino_.*|prometheus|alertmanager|grafana"}',
  lastScrape: 'timestamp(up{job=~"funtino_.*|prometheus|alertmanager|grafana"})',
  requestsPerSecond:
    'sum by (service) (rate(funtino_http_server_requests_total{service=~"' +
    serviceMatcher +
    '"}[5m]))',
  serverErrorsPerSecond:
    'sum by (service) (rate(funtino_http_server_requests_total{service=~"' +
    serviceMatcher +
    '",status=~"5.."}[5m]))',
  p95LatencySeconds:
    'histogram_quantile(0.95, sum by (service, le) (rate(funtino_http_server_request_duration_seconds_bucket{service=~"' +
    serviceMatcher +
    '"}[5m])))',
  activeAlerts: 'ALERTS{alertstate="firing",alertname=~"Funtino.*"}',
} as const;

type PrometheusSample = {
  metric: Record<string, unknown>;
  value: [number, string];
};

type PrometheusQueryResponse = {
  status?: unknown;
  data?: { resultType?: unknown; result?: unknown };
};

type PrometheusVector = PrometheusSample[];

export interface PrometheusTelemetryClientOptions {
  baseUrl?: () => string | undefined;
  fetcher?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  staleAfterSeconds?: number;
}

export class PrometheusTelemetryClient {
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly staleAfterSeconds: number;
  private readonly configuredBaseUrl: () => string | undefined;

  constructor(options: PrometheusTelemetryClientOptions = {}) {
    this.fetcher = options.fetcher ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 3_000;
    this.staleAfterSeconds = options.staleAfterSeconds ?? 90;
    this.configuredBaseUrl = options.baseUrl ?? (() => process.env.PROMETHEUS_INTERNAL_URL);
  }

  async readSystemHealth(): Promise<SystemHealthSnapshot> {
    const baseUrl = this.prometheusBaseUrl();
    const [availability, lastScrape, requestRates, errorRates, p95Latencies, alertSamples] =
      await Promise.all([
        this.query(baseUrl, queries.availability),
        this.query(baseUrl, queries.lastScrape),
        this.query(baseUrl, queries.requestsPerSecond),
        this.query(baseUrl, queries.serverErrorsPerSecond),
        this.query(baseUrl, queries.p95LatencySeconds),
        this.query(baseUrl, queries.activeAlerts),
      ]);

    const now = this.now();
    const upByService = groupSamples(availability);
    const scrapeByService = singleValueByService(lastScrape);
    const requestsByService = singleValueByService(requestRates);
    const errorsByService = singleValueByService(errorRates);
    const latencyByService = singleValueByService(p95Latencies);
    const alerts = presentAlerts(alertSamples);
    const alertsByService = new Set(alerts.map((alert) => alert.service));

    return {
      observedAt: new Date(now).toISOString(),
      source: 'prometheus',
      services: expectedServices.map(({ key, name }) => {
        const targets = upByService.get(key) ?? [];
        const unavailableTargets = targets.filter((sample) => sample.value[1] === '0').length;
        const scrapeTimes = (scrapeByService.get(key) ?? []).filter(Number.isFinite);
        const lastScrapedAtMs = scrapeTimes.length ? Math.min(...scrapeTimes) * 1_000 : null;
        const freshnessSeconds =
          lastScrapedAtMs === null
            ? null
            : Math.max(0, Math.floor((now - lastScrapedAtMs) / 1_000));
        const requestsPerSecond = finiteOrNull(firstValue(requestsByService.get(key)));
        const serverErrorsPerSecond = finiteOrNull(firstValue(errorsByService.get(key)));
        const totalRate = requestsPerSecond ?? 0;
        const serverErrorPercent =
          totalRate > 0 && serverErrorsPerSecond !== null
            ? Math.max(0, Math.min(100, (serverErrorsPerSecond / totalRate) * 100))
            : null;
        const p95Seconds = finiteOrNull(firstValue(latencyByService.get(key)));
        const hasStaleTarget =
          freshnessSeconds !== null && freshnessSeconds > this.staleAfterSeconds;
        const status: SystemHealthStatus =
          targets.length === 0
            ? 'unknown'
            : unavailableTargets === targets.length
              ? 'down'
              : hasStaleTarget && unavailableTargets === 0
                ? 'stale'
                : unavailableTargets > 0 || alertsByService.has(key)
                  ? 'degraded'
                  : 'healthy';

        return {
          key,
          name,
          status,
          targets: targets.length,
          unavailableTargets,
          requestsPerSecond,
          serverErrorPercent,
          p95LatencyMs: p95Seconds === null ? null : Math.round(p95Seconds * 1_000 * 100) / 100,
          freshnessSeconds,
          lastScrapedAt: lastScrapedAtMs === null ? null : new Date(lastScrapedAtMs).toISOString(),
        };
      }),
      activeAlerts: alerts,
    };
  }

  private prometheusBaseUrl(): URL {
    const configured = this.configuredBaseUrl();
    if (!configured) throw new PrometheusTelemetryUnavailableError();

    try {
      const url = new URL(configured);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')
      ) {
        throw new Error('invalid');
      }
      return url;
    } catch {
      throw new PrometheusTelemetryUnavailableError();
    }
  }

  private async query(baseUrl: URL, expression: string): Promise<PrometheusVector> {
    const url = new URL(baseUrl.href);
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/api/v1/query`;
    url.searchParams.set('query', expression);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) throw new PrometheusTelemetryUnavailableError();
      const body = (await response.json()) as PrometheusQueryResponse;
      if (body.status !== 'success' || body.data?.resultType !== 'vector') {
        throw new PrometheusTelemetryUnavailableError();
      }
      return parseVector(body.data.result);
    } catch {
      throw new PrometheusTelemetryUnavailableError();
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseVector(value: unknown): PrometheusVector {
  if (!Array.isArray(value)) throw new PrometheusTelemetryUnavailableError();
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new PrometheusTelemetryUnavailableError();
    const sample = item as Partial<PrometheusSample>;
    if (
      !sample.metric ||
      typeof sample.metric !== 'object' ||
      !Array.isArray(sample.value) ||
      sample.value.length !== 2 ||
      !Number.isFinite(Number(sample.value[0])) ||
      !Number.isFinite(Number(sample.value[1]))
    ) {
      throw new PrometheusTelemetryUnavailableError();
    }
    return sample as PrometheusSample;
  });
}

function groupSamples(samples: PrometheusVector): Map<string, PrometheusSample[]> {
  const grouped = new Map<string, PrometheusSample[]>();
  for (const sample of samples) {
    const service = sample.metric.service;
    if (typeof service !== 'string' || !serviceKeys.has(service)) continue;
    const group = grouped.get(service) ?? [];
    group.push(sample);
    grouped.set(service, group);
  }
  return grouped;
}

function singleValueByService(samples: PrometheusVector): Map<string, number[]> {
  const grouped = new Map<string, number[]>();
  for (const sample of samples) {
    const service = sample.metric.service;
    if (typeof service !== 'string' || !serviceKeys.has(service)) continue;
    const group = grouped.get(service) ?? [];
    group.push(Number(sample.value[1]));
    grouped.set(service, group);
  }
  return grouped;
}

function presentAlerts(samples: PrometheusVector): SystemHealthAlert[] {
  const unique = new Map<string, SystemHealthAlert>();
  for (const sample of samples) {
    const name = sample.metric.alertname;
    const service = sample.metric.service;
    if (
      typeof name !== 'string' ||
      !/^Funtino[A-Za-z0-9]+$/.test(name) ||
      typeof service !== 'string' ||
      !serviceKeys.has(service)
    ) {
      continue;
    }
    const rawSeverity = sample.metric.severity;
    const severity: SystemHealthSeverity =
      rawSeverity === 'critical' || rawSeverity === 'info' ? rawSeverity : 'warning';
    unique.set(name + '|' + service, { name, service, severity });
  }
  return [...unique.values()].sort(
    (left, right) =>
      left.severity.localeCompare(right.severity) || left.name.localeCompare(right.name),
  );
}

function firstValue(values: number[] | undefined): number | null {
  return values?.[0] ?? null;
}

function finiteOrNull(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null;
}
