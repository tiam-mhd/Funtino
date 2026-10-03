import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(root, 'package.json'));
const yaml = require('js-yaml');
const monitoring = path.join(root, 'infra', 'monitoring');

async function readYaml(relativePath) {
  return yaml.load(await fs.readFile(path.join(monitoring, relativePath), 'utf8'));
}

const backendTargets = [
  ['api-gateway', 'funtino_api_gateway', 'api_gateway_metrics_token'],
  ['realtime-gateway', 'funtino_realtime_gateway', 'realtime_metrics_token'],
  ['device-integration', 'funtino_device_integration', 'device_integration_metrics_token'],
  ['wallet', 'funtino_wallet', 'wallet_metrics_token'],
  ['notifications', 'funtino_notifications', 'notifications_metrics_token'],
  ['identity-access', 'funtino_identity_access', 'identity_access_metrics_token'],
  ['organization-branch', 'funtino_organization_branch', 'organization_branch_metrics_token'],
  ['analytics-read-model', 'funtino_analytics_read_model', 'analytics_metrics_token'],
];

const prometheus = await readYaml('prometheus/prometheus.yml');
const jobs = new Map(prometheus.scrape_configs.map((job) => [job.job_name, job]));
assert.ok(jobs.has('prometheus'), 'Prometheus must scrape itself.');
assert.ok(jobs.has('alertmanager'), 'Alertmanager must be scraped for operational availability.');
assert.ok(jobs.has('grafana'), 'Grafana must be scraped for operational availability.');
assert.equal(jobs.get('prometheus').static_configs[0].targets[0], '127.0.0.1:9090');
assert.equal(jobs.get('alertmanager').static_configs[0].targets[0], 'alertmanager:9093');
assert.equal(jobs.get('grafana').static_configs[0].targets[0], 'grafana:3000');

for (const [service, jobName, secretName] of backendTargets) {
  const job = jobs.get(jobName);
  assert.ok(job, `Missing scrape job ${jobName}.`);
  assert.equal(job.metrics_path, '/internal/metrics', `${service} scrape path must stay internal.`);
  assert.equal(
    job.scheme,
    'https',
    `${service} must use HTTPS unless a local target explicitly overrides it.`,
  );
  assert.equal(
    job.authorization?.credentials_file,
    `/run/secrets/${secretName}`,
    `${service} must use its own runtime token file.`,
  );
  const targetFile = job.file_sd_configs?.[0]?.files?.[0];
  assert.equal(targetFile, `/etc/prometheus/targets/${service}.json`);
  const example = JSON.parse(
    await fs.readFile(
      path.join(monitoring, 'targets', 'examples', `${service}.json.example`),
      'utf8',
    ),
  );
  assert.equal(example.length, 1);
  assert.equal(example[0].labels.service, service);
  assert.equal(example[0].labels.environment, 'local');
  assert.equal(
    example[0].labels.__scheme__,
    'http',
    `${service} example must explicitly mark local HTTP.`,
  );
}

const rabbitmqJob = jobs.get('funtino_rabbitmq');
assert.ok(rabbitmqJob, 'RabbitMQ must be scraped for queue health.');
assert.equal(rabbitmqJob.metrics_path, '/metrics/detailed');
assert.ok(rabbitmqJob.params.family.includes('queue_coarse_metrics'));
assert.ok(rabbitmqJob.file_sd_configs[0].files[0].endsWith('/rabbitmq.json'));

const rules = await readYaml('prometheus/alerts/funtino.rules.yml');
const alerts = rules.groups.flatMap((group) => group.rules).filter((rule) => rule.alert);
const alertNames = new Set(alerts.map((rule) => rule.alert));
for (const required of [
  'FuntinoBackendScrapeFailed',
  'FuntinoBackendHigh5xxRate',
  'FuntinoBackendHighP95Latency',
  'FuntinoRabbitMQQueueBacklog',
  'FuntinoRabbitMQTargetMissing',
  'FuntinoAlertmanagerTargetMissing',
  'FuntinoGrafanaTargetMissing',
]) {
  assert.ok(alertNames.has(required), `Missing operational alert ${required}.`);
}
assert.ok(alerts.every((alert) => alert.annotations?.runbook?.startsWith('DOCS/runbooks/')));
assert.ok(
  alerts.every((alert) => !JSON.stringify(alert).includes('.invalid')),
  'Operational alerts must not contain placeholder destinations or links.',
);

const alertmanager = await readYaml('alertmanager/alertmanager.yml');
assert.equal(alertmanager.route.receiver, 'funtino-operations-webhook');
assert.ok(
  alertmanager.receivers[0].webhook_configs[0].url_file.startsWith('/run/secrets/'),
  'Alert delivery URL must only come from a runtime secret file.',
);

const dashboard = JSON.parse(
  await fs.readFile(
    path.join(monitoring, 'grafana', 'dashboards', 'funtino-operations.json'),
    'utf8',
  ),
);
const panelQueries = dashboard.panels.flatMap((panel) =>
  panel.targets.map((target) => target.expr),
);
for (const expression of [
  'ALERTS{alertstate="firing",alertname=~"Funtino.*"}',
  'rabbitmq_detailed_queue_messages_ready',
  'histogram_quantile(0.95',
  'prometheus|alertmanager|grafana',
]) {
  assert.ok(
    panelQueries.some((query) => query.includes(expression)),
    `Dashboard is missing ${expression}.`,
  );
}

const compose = await readYaml('compose.yml');
for (const [name, expectedImage] of [
  ['prometheus', 'prom/prometheus:v3.14.0'],
  ['alertmanager', 'prom/alertmanager:v0.34.1'],
  ['grafana', 'grafana/grafana:13.2.2'],
]) {
  assert.equal(compose.services[name]?.image, expectedImage);
  assert.ok(
    compose.services[name].ports.every((port) => String(port).startsWith('127.0.0.1:')),
    `${name} must bind to loopback in local Compose.`,
  );
}

process.stdout.write(
  `Monitoring wiring/configuration passed: ${backendTargets.length} token-protected backends, RabbitMQ, ${alerts.length} alerts, and ${dashboard.panels.length} dashboard panels. PromQL parser validation requires promtool.\n`,
);
