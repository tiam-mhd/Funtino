# Runbook: operational telemetry

## Monitoring stack health

Prometheus, Alertmanager, and Grafana are scraped as first-class targets in addition to eight backend processes and RabbitMQ. A missing Alertmanager is critical; a missing Grafana target is warning. A Prometheus self-scrape alert is visible in Grafana only while Prometheus itself is reachable, so configure an external uptime monitor for the monitoring host before production.

This runbook covers the source-controlled Prometheus, Grafana and Alertmanager setup under `infra/monitoring`. The local Compose stack is not a production deployment. Production hostnames, TLS, secret mounts, notification destination and alert ownership must be approved and recorded by Operations before pilot.

## Target scrape failure

1. In Prometheus Targets, confirm the failing job and sanitized `service` label; never paste bearer tokens or full secret paths into an incident ticket.
2. Check the service's private health/readiness endpoint and deployment event.
3. Verify the target file points to the approved private address and `/internal/metrics` path. Production targets must use HTTPS; local examples explicitly override to HTTP and must not be copied unchanged to staging/production.
4. Verify that the service's runtime metrics token and the matching Prometheus secret file are the same independently generated value (minimum 32 random characters). Do not rotate both sides during an incident without a coordinated change window.
5. Check TLS and private-network reachability. Do not make `/internal/metrics` or Prometheus public as a workaround.
6. If the service is healthy but only telemetry configuration changed, revert that monitoring config revision and recheck target recovery.

## Missing target

1. Confirm the service has a deployed, telemetry-enabled version in the same environment.
2. Add its approved private address to the matching file-discovery target file; preserve the exact `service` and `environment` labels.
3. Confirm the correct per-service token file is mounted read-only.
4. File discovery reloads target files automatically; do not restart the application to add a target.
5. Verify an `up=1` sample and a recent scrape before closing the alert.

## HTTP 5xx or latency alert

1. Use the Grafana service, status, rate and p95 panels to establish impact and onset.
2. Correlate by request/correlation ID from the service's structured logs; do not log request bodies, query values, cookies, authorization headers or customer identifiers.
3. Check recent deployment, database/broker readiness and dependency alerts.
4. If a deployment is the cause, redeploy the last known-good image only after confirming the current schema remains backward-compatible. Do not reverse a forward-only migration by hand.
5. Reconcile the issue, then tune the initial 5%/1-second alert candidates with Operations; they are not approved SLOs.

## RabbitMQ backlog alert

1. Inspect the affected vhost/queue and consumer count in Grafana and the private RabbitMQ management interface.
2. Check worker health, consumer errors, broker disk/memory alarms and recent message-rate changes.
3. Do not purge, replay, requeue or delete queues as an alert response. Use the owning service's incident procedure and idempotency guarantees.
4. This initial topology has no declared dead-letter queues or retry counters. A dead-letter alert must not be treated as available until the queue topology and owner contracts define it.
5. Tune the 1,000-message threshold per queue after observing pilot traffic and broker topology.

## Alert delivery verification

1. Use a dedicated test webhook receiver, never a production incident channel, while testing.
2. Trigger an approved synthetic alert or use Alertmanager's documented test path.
3. Confirm one firing notification and one resolved notification reach the receiver and that duplicate delivery is tolerated.
4. Confirm the configured URL is only present in the runtime secret file and is absent from logs, repository files and screenshots.

## System Web dashboard access

The public System Web landing page contains no live metrics. The `/fa/system-health` page calls the Gateway's fixed, read-only Prometheus summary endpoint. A valid session and global `system.health.read` permission are checked server-side. The API intentionally omits target addresses and does not accept arbitrary PromQL. A 401/403 is an identity/permission issue; a 503 means the private telemetry source is unavailable or not configured. Services with no configured target are displayed as unknown, not healthy.
