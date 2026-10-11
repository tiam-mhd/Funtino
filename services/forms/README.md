# Forms Service

`forms` owns the `forms` PostgreSQL schema, form drafts and published versions, responses, templates, audit records, and its Outbox. Only the API Gateway may call its internal HTTP API. It does not read organization, branch, IAM, customer, wallet, or Gateway tables.

## Local setup

Configure `FORMS_DATABASE_URL`, `FORMS_MIGRATION_DATABASE_URL`, `FORMS_API_GATEWAY_TOKEN`, and `RABBITMQ_URL` from a local secret source. Do not put credentials in this file or commit a populated `.env`.

## Manual migration

Forms is not one of the startup-migration Workers in ADR-0015. Before deployment, use the service-owned DDL credential in the approved migration job to create the schema once:

```sql
CREATE SCHEMA IF NOT EXISTS forms;
```

Then run `pnpm --filter @funtino/forms prisma:migrate` in the controlled release job. The API process only receives its runtime database credential. Rollback is a forward-compatible corrective migration; do not delete response rows as a rollback step.

## Data handling

- Customer identity is stored only when an authenticated caller explicitly consents to link the response.
- Response content is excluded from logs, event payloads, and error messages.
- Corrections require the separately scoped `forms.responses.correct` permission. Sensitive-field corrections also require `forms.responses.pii.read` with a current MFA step-up; current answers update transactionally while each before/after value, actor, reason, time, and correction version stays in the append-only correction journal.
- Until a retention policy is approved, responses remain stored and no automatic deletion/anonymization job runs.
- File, image, and signature fields are not enabled until an approved object-storage provider and authorized-download contract exist.
