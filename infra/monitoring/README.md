# Funtino monitoring stack

This directory contains a private Prometheus → Grafana/Alertmanager integration. It consumes the existing token-protected backend metrics endpoint and does not expose backend metrics or the Prometheus query API on a public interface.

## Local setup

1. Start the existing local dependencies with `docker compose -f infra/docker-compose.yml up -d`. The default network is `funtino-local_default`; do not publish RabbitMQ's Prometheus port to the host.
2. Create the files named in `compose.yml` under `infra/monitoring/secrets/`. Generate distinct random tokens (at least 32 characters) for each backend, set each matching `*_METRICS_TOKEN` in that backend's local runtime, and put only the matching token in its scraper file. Create a private Grafana admin password and set `operations-alert-webhook-url` to an approved test receiver. Never commit these files.
3. Copy only the needed `targets/examples/*.json.example` files to `targets/<service>.json`, then verify the target address and environment label. The examples explicitly override backend HTTPS with local HTTP; for production, remove that `__scheme__` override and use private TLS endpoints. The files in `examples/` are documentation fixtures, not active targets.
4. Start the monitoring stack with `docker compose -f infra/monitoring/compose.yml up -d`. Grafana is bound to `127.0.0.1:3001`; Prometheus and Alertmanager are bound to loopback for local diagnostics only.
5. Configure `PROMETHEUS_INTERNAL_URL` for the API Gateway to the private Prometheus base URL. Production must use private HTTPS. Do not expose Prometheus's query API to the public internet.

RabbitMQ uses its built-in Prometheus plugin and `/metrics/detailed` for queue-depth and consumer-count metrics. The endpoint has no per-scrape bearer token in this configuration; it must remain on the private monitoring network. In production, operations must enable the plugin on the managed broker and allow only the scraper network to reach its metrics listener.

## Initial alert rules

- backend scrape failure for 2 minutes (critical);
- missing backend/RabbitMQ target for 10 minutes (warning);
- HTTP 5xx above 5% with minimum traffic for 10 minutes (warning);
- p95 HTTP latency above 1 second for 10 minutes (warning);
- RabbitMQ ready-message backlog above 1,000 for 5 minutes (warning).

HTTP and queue thresholds are candidate defaults, not approved product SLOs. Operations must calibrate them against pilot traffic and queue topology. RabbitMQ dead-letter queues, consumer retry counters, database-exporter metrics, device-sync freshness and business-event freshness are not yet emitted/configured; no dashboard or alert claims to cover those signals until their owners provide safe metrics and queue contracts.

Alert notifications use Alertmanager's generic webhook receiver. The URL is read from a runtime-only secret file; the concrete destination (incident manager, email bridge, or approved webhook) is chosen by Operations, not embedded in source. The receiver must be idempotent because webhook delivery may be retried.

## Production gate

The Compose file is a local development/test topology, not a Runflare production deployment. Runflare currently has no dedicated monitoring item or private-network target map in this workspace. Before pilot, provision a private monitoring environment, configure all target and secret files through the secret manager, confirm the selected webhook receiver, verify dashboards and alert delivery end-to-end, and record alert threshold approvals. The System Web summary is served only by the authenticated Gateway endpoint requiring `system.health.read`; the public System Web landing page does not contain live metrics.
