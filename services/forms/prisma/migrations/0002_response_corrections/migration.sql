ALTER TABLE forms.form_responses
  ADD COLUMN correction_version INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT form_responses_correction_version_check CHECK (correction_version >= 0);

CREATE TABLE forms.form_response_corrections (
    id UUID PRIMARY KEY,
    response_id UUID NOT NULL REFERENCES forms.form_responses(id) ON DELETE RESTRICT,
    field_id UUID NOT NULL,
    correction_version INTEGER NOT NULL,
    previous_present BOOLEAN NOT NULL,
    previous_value JSONB NOT NULL,
    new_present BOOLEAN NOT NULL,
    new_value JSONB NOT NULL,
    reason VARCHAR(500) NOT NULL,
    actor_user_id UUID NOT NULL,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT form_response_corrections_version_check CHECK (correction_version > 0),
    CONSTRAINT form_response_corrections_response_version_field_key UNIQUE (response_id, correction_version, field_id)
);
CREATE INDEX form_response_corrections_response_created_idx ON forms.form_response_corrections (response_id, created_at);

CREATE FUNCTION forms.reject_form_response_correction_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'form response corrections are append-only' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER form_response_corrections_append_only
  BEFORE UPDATE OR DELETE ON forms.form_response_corrections
  FOR EACH ROW EXECUTE FUNCTION forms.reject_form_response_correction_mutation();

CREATE TRIGGER form_response_corrections_reject_truncate
  BEFORE TRUNCATE ON forms.form_response_corrections
  FOR EACH STATEMENT EXECUTE FUNCTION forms.reject_form_response_correction_mutation();
