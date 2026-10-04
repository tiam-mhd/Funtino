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

## Diagnose one failed request across backend services

1. From `http.request.complete` or the client response, copy the `correlationId`. Use `requestId` only to locate that single HTTP hop; every outgoing request gets its own request ID.
2. Search all backend logs for the same `correlationId`. The Gateway records `http.request.exception`; outgoing Node `fetch` records `dependency.http.completed` or `dependency.http.failed`; invalid JSON responses add `dependency.response.json_failed`; downstream services record their own request and exception with that correlation ID.
3. In `dependency.http.failed`, inspect `dependencyHost`, `dependencyPort`, `method`, `durationMs`, `error.type`, cause codes, and `origin`. In `dependency.http.completed`, inspect `status` and `outcome`. A returned 5xx means the target replied; a transport error means the HTTP request did not receive a usable response.
4. In `http.request.exception`, inspect `component`, `stage`, `status`, `origin`, `error.type`, `error.code`, `error.causes`, `error.frames` and any safe database fields such as `sqlState`, `modelName` or `table`. Search downstream by `correlationId` to find the original exception.
5. If the client has a dependency event but the target has no request record, investigate DNS, TLS, port, route and network reachability. If both sides logged the same correlation ID, start from the target's exception and follow its causes/frames back to the Gateway response.
6. Keep `dependencyHost` and `dependencyPort` inside private operations channels. Never paste environment variables, request/response bodies, cookies, authorization headers, OTPs or provider credentials into a ticket.

These records omit raw exception messages and bodies by design. Use the type/code, cause chain, stage and source frames to identify the failing boundary without disclosing sensitive input.

## Database readiness, background work, and process failures

1. For a readiness `503`, search for `service.readiness.failed` using the same `correlationId`. Check `service`, `component`, `stage`, and `dependency`; `configurationKeys` names missing or invalid settings without recording their values. A database failure includes safe Prisma/PostgreSQL codes and table/model metadata where available.
2. For event delivery, search `outbox.delivery.batch_failed`, `outbox.batch_failed`, and `outbox.envelope.invalid`. These records identify whether failure happened during RabbitMQ publish, PostgreSQL acknowledgement, batch claim, or envelope validation. The `failures` array is capped to a few event IDs/types and never includes payloads.
3. For consumer errors, search `event.consumer.failed` by `correlationId`, `eventId`, or queue. Check `stage` to distinguish decode/validation from handler failure; rejected messages are still dead-lettered according to the existing queue policy.
4. For a process that exits unexpectedly, search `process.uncaught_exception` and check `stage`, `error.code`, cause codes, and source frames. Node's existing crash behavior remains in effect after the diagnostic is written.
5. To report an incident, send the `correlationId` plus all matching JSON records from every backend service around the same timestamp. Include the `requestId` only for the specific HTTP hop. Remove credentials and do not send environment variable values, cookies, OTPs, request/response bodies, or customer data.

Background work may have no HTTP `correlationId`; in that case use its `eventId`, queue, service, and timestamp to connect the batch, consumer, and dependency records.

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
