# Runbook: backup, restore, and application rollback

This runbook separates three operations that have different blast radii: creating/verifying a backup, restoring data to a new database, and rolling an application image back. Migration history is forward-only; never treat a database restore as an ordinary application rollback.

## Safety boundary

- Start with a disposable local cluster or an approved staging clone. Production restore/cutover requires incident approval from the data owner and Operations.
- Confirm the source environment, owner service/schema, backup timestamp, encryption, retention, and restore target before execution. Do not paste connection URLs, passwords, backup contents, or customer data into chat, logs, or tickets.
- The restore target must be a different, fresh database named with an approved `funtino_restore_*`, `funtino_scratch_*`, `funtino_test_*`, or `funtino_ci_*` prefix. The smoke script does not drop or create databases.
- Never overwrite the source database or restore into a shared/production target as a drill. Restore to a new target, verify it, and only then plan a separately approved cutover.
- Record UTC start/end, operator, source and target identifiers (non-secret), backup id, archive checksum, PostgreSQL version, restore duration, verified object/row checks, and measured recovery point/time.

## Backup and restore rehearsal

1. Provision an isolated PostgreSQL cluster or an approved staging clone and create a source database plus an empty restore database.
2. Seed only synthetic, non-customer data and record expected schema/table counts and deterministic marker rows.
3. Inject `SOURCE_DATABASE_URL` and `RESTORE_DATABASE_URL` through the local process environment or secret manager. Do not add them to `.env`, CI output, or shell history.
4. Run `pnpm database:restore-smoke`. It uses a custom-format `pg_dump`, restores with `pg_restore`, compares user relation/schema counts, and leaves both databases in place. It removes only its generated temporary archive directory.
5. Independently query the restored marker rows and run the owning service's read-only smoke/reconciliation checks. A matching relation count alone does not prove data correctness or object-storage recovery.
6. Measure backup and restore durations. For staging, verify off-host/object-storage recovery, PITR if configured, encryption/key access, retention, and separately defined RPO/RTO. Record failures and clean up only the explicitly created disposable resources after confirming the target path/identifier.

## Application image rollback

1. Identify the exact service, current deployed image digest, last known-good image digest, deployment repository/branch, and release change window. The previous image must be immutable and retrievable.
2. Inspect every migration/backfill since that image. Roll back the application only if the database schema and data remain backward-compatible; otherwise stop and prepare a forward fix or a data-owner-approved recovery plan.
3. Roll back only the named service through the approved deployment control plane. Do not edit a deployment repository manually, force-push, or run `migrate down`.
4. Verify image digest, health/readiness, logs without secret/customer data, and a service-specific smoke test. Confirm dependent services remain compatible and document the result.
5. If data itself must be recovered, restore a verified backup to a new database and prepare an explicit, owner-approved cutover. This is a separate incident action, not part of the image rollback.

## Drill record

| Field                                         | Record                            |
| --------------------------------------------- | --------------------------------- |
| Environment / owner service                   | Pending approved staging target   |
| Backup identifier / checksum                  | Not run                           |
| Source / restore target identifiers           | Not run                           |
| Backup and restore duration                   | Not measured                      |
| Data and object-storage checks                | Not run                           |
| RPO / RTO measured against target             | Not run                           |
| Application service and old/new image digests | Awaiting approved rollback target |
| Health/smoke result and approvers             | Not run                           |

The local disposable cluster rehearsal was attempted on 2026-10-01 but was blocked before cluster initialization: Windows sandbox restrictions prevented PostgreSQL `initdb` from creating its restricted token/temp path. The existing PostgreSQL Windows service and its data were not touched. Docker Engine is unavailable in this workspace. No staging backup, restore, image rollback, or production action is claimed by this record.
