CREATE SCHEMA IF NOT EXISTS forms;

CREATE TYPE forms.form_status AS ENUM ('draft', 'published', 'paused', 'archived');
CREATE TYPE forms.form_access_mode AS ENUM ('guest', 'optional_auth', 'auth_required');
CREATE TYPE forms.response_status AS ENUM ('new', 'in_review', 'followed_up', 'closed', 'spam');
CREATE TYPE forms.template_scope_type AS ENUM ('global', 'organization', 'branch');

CREATE TABLE forms.forms (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL,
    branch_id UUID NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    title VARCHAR(160) NOT NULL,
    description VARCHAR(1500) NOT NULL DEFAULT '',
    status forms.form_status NOT NULL DEFAULT 'draft',
    access_mode forms.form_access_mode NOT NULL DEFAULT 'guest',
    link_enabled BOOLEAN NOT NULL DEFAULT false,
    starts_at TIMESTAMPTZ(6),
    ends_at TIMESTAMPTZ(6),
    response_limit INTEGER,
    response_count INTEGER NOT NULL DEFAULT 0,
    current_version INTEGER,
    draft_schema JSONB NOT NULL,
    template_id UUID,
    created_by_user_id UUID NOT NULL,
    updated_by_user_id UUID NOT NULL,
    published_at TIMESTAMPTZ(6),
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT forms_response_limit_check CHECK (response_limit IS NULL OR response_limit > 0),
    CONSTRAINT forms_response_count_check CHECK (response_count >= 0),
    CONSTRAINT forms_window_check CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX forms_tenant_status_created_idx ON forms.forms (organization_id, branch_id, status, created_at DESC);
CREATE INDEX forms_organization_status_created_idx ON forms.forms (organization_id, status, created_at DESC);

CREATE TABLE forms.form_versions (
    id UUID PRIMARY KEY,
    form_id UUID NOT NULL REFERENCES forms.forms(id) ON DELETE RESTRICT,
    version INTEGER NOT NULL,
    schema_version INTEGER NOT NULL,
    definition JSONB NOT NULL,
    published_by_id UUID NOT NULL,
    published_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT form_versions_version_check CHECK (version > 0),
    CONSTRAINT form_versions_form_version_key UNIQUE (form_id, version)
);
CREATE INDEX form_versions_form_published_idx ON forms.form_versions (form_id, published_at DESC);

CREATE TABLE forms.form_responses (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL,
    branch_id UUID NOT NULL,
    form_id UUID NOT NULL REFERENCES forms.forms(id) ON DELETE RESTRICT,
    form_version_id UUID NOT NULL REFERENCES forms.form_versions(id) ON DELETE RESTRICT,
    customer_id UUID,
    customer_consent_at TIMESTAMPTZ(6),
    idempotency_key VARCHAR(80) NOT NULL,
    payload_hash CHAR(64) NOT NULL,
    answers JSONB NOT NULL,
    status forms.response_status NOT NULL DEFAULT 'new',
    tags TEXT[] NOT NULL DEFAULT '{}',
    submitted_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT form_responses_form_idempotency_key UNIQUE (form_id, idempotency_key),
    CONSTRAINT form_responses_customer_consent_check CHECK ((customer_id IS NULL) = (customer_consent_at IS NULL))
);
CREATE INDEX form_responses_tenant_form_submitted_idx ON forms.form_responses (organization_id, branch_id, form_id, submitted_at DESC);
CREATE INDEX form_responses_tenant_status_submitted_idx ON forms.form_responses (organization_id, form_id, status, submitted_at DESC);

CREATE TABLE forms.form_response_notes (
    id UUID PRIMARY KEY,
    response_id UUID NOT NULL REFERENCES forms.form_responses(id) ON DELETE RESTRICT,
    author_user_id UUID NOT NULL,
    body VARCHAR(2000) NOT NULL,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX form_response_notes_response_created_idx ON forms.form_response_notes (response_id, created_at);

CREATE TABLE forms.form_templates (
    id UUID PRIMARY KEY,
    scope_type forms.template_scope_type NOT NULL DEFAULT 'global',
    organization_id UUID,
    branch_id UUID,
    name VARCHAR(120) NOT NULL,
    description VARCHAR(500) NOT NULL DEFAULT '',
    definition JSONB NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    version INTEGER NOT NULL DEFAULT 1,
    created_by_user_id UUID NOT NULL,
    updated_by_user_id UUID NOT NULL,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT form_templates_scope_check CHECK (
      (scope_type = 'global' AND organization_id IS NULL AND branch_id IS NULL) OR
      (scope_type = 'organization' AND organization_id IS NOT NULL AND branch_id IS NULL) OR
      (scope_type = 'branch' AND organization_id IS NOT NULL AND branch_id IS NOT NULL)
    ),
    CONSTRAINT form_templates_version_check CHECK (version > 0)
);
CREATE INDEX form_templates_scope_enabled_name_idx ON forms.form_templates (scope_type, organization_id, branch_id, enabled, name);

CREATE TABLE forms.form_platform_settings (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    default_theme JSONB NOT NULL,
    updated_by_user_id UUID NOT NULL,
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE forms.form_audit_logs (
    id UUID PRIMARY KEY,
    actor_user_id UUID,
    action VARCHAR(80) NOT NULL,
    target_type VARCHAR(40) NOT NULL,
    target_id VARCHAR(80) NOT NULL,
    organization_id UUID,
    branch_id UUID,
    reason VARCHAR(500),
    metadata JSONB,
    correlation_id UUID,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX form_audit_target_created_idx ON forms.form_audit_logs (target_type, target_id, created_at DESC);
CREATE INDEX form_audit_scope_created_idx ON forms.form_audit_logs (organization_id, branch_id, created_at DESC);

CREATE TABLE forms.outbox_events (
    id UUID PRIMARY KEY,
    event_type VARCHAR(160) NOT NULL,
    event_version INTEGER NOT NULL,
    aggregate_id VARCHAR(160) NOT NULL,
    envelope JSONB NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    available_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lease_token UUID,
    lease_expires_at TIMESTAMPTZ(6),
    published_at TIMESTAMPTZ(6),
    dead_lettered_at TIMESTAMPTZ(6),
    last_error_code VARCHAR(80),
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX forms_outbox_pending_idx ON forms.outbox_events (available_at, created_at) WHERE published_at IS NULL AND dead_lettered_at IS NULL;
