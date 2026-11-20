CREATE TABLE feedback_sources (
  id uuid PRIMARY KEY,
  source_project_id uuid NOT NULL REFERENCES source_projects(id),
  base_id text NOT NULL, sheet_id text NOT NULL,
  confirmed_by uuid NOT NULL REFERENCES people(id),
  confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  enabled boolean NOT NULL DEFAULT true,
  UNIQUE(base_id,sheet_id)
);
CREATE TABLE executor_identity_mappings (
  source_project_id uuid NOT NULL REFERENCES source_projects(id),
  executor_source_id text NOT NULL,
  person_id uuid NOT NULL REFERENCES people(id),
  confirmed_by uuid NOT NULL REFERENCES people(id),
  confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  enabled boolean NOT NULL DEFAULT true,
  PRIMARY KEY(source_project_id,executor_source_id),
  UNIQUE(source_project_id,person_id)
);
CREATE TABLE feedback_records (
  id uuid PRIMARY KEY, source_id uuid NOT NULL REFERENCES feedback_sources(id),
  source_record_id text NOT NULL, created_time bigint, source_present boolean NOT NULL DEFAULT true,
  work_item_id uuid REFERENCES work_items(id), latest_revision_id uuid,
  UNIQUE(source_id,source_record_id)
);
CREATE TABLE feedback_revisions (
  id uuid PRIMARY KEY, record_id uuid NOT NULL REFERENCES feedback_records(id),
  revision_hash text NOT NULL, raw_source jsonb NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(record_id,revision_hash)
);
ALTER TABLE feedback_records ADD FOREIGN KEY(latest_revision_id) REFERENCES feedback_revisions(id);
CREATE TABLE feedback_validations (
  id uuid PRIMARY KEY, revision_id uuid NOT NULL REFERENCES feedback_revisions(id),
  context_hash text NOT NULL, verdict text NOT NULL CHECK(verdict IN ('valid','reject','review')),
  reasons jsonb NOT NULL, progress_percent integer CHECK(progress_percent BETWEEN 0 AND 100),
  checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(revision_id,context_hash)
);
CREATE TABLE valid_feedback_history (
  id uuid PRIMARY KEY, work_item_id uuid NOT NULL REFERENCES work_items(id),
  validation_id uuid NOT NULL UNIQUE REFERENCES feedback_validations(id),
  revision_id uuid NOT NULL UNIQUE REFERENCES feedback_revisions(id),
  submitted_at timestamptz NOT NULL, progress_percent integer NOT NULL CHECK(progress_percent BETWEEN 0 AND 100),
  situation text NOT NULL, note text NOT NULL, submitter_id uuid NOT NULL REFERENCES people(id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE current_feedback (
  work_item_id uuid PRIMARY KEY REFERENCES work_items(id),
  history_id uuid REFERENCES valid_feedback_history(id),
  state text NOT NULL CHECK(state IN ('valid','unknown','review')),
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  checked_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE source_bindings ADD COLUMN unique_id_prefix text;
CREATE INDEX ON feedback_records(work_item_id);
CREATE INDEX ON valid_feedback_history(work_item_id,submitted_at);
ALTER TABLE feedback_records ADD COLUMN created_by_union_id text;

CREATE TABLE feedback_reviews (
 validation_id uuid PRIMARY KEY REFERENCES feedback_validations(id),
 approved_by uuid NOT NULL REFERENCES people(id), reason text NOT NULL,
 approved_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE feedback_records ADD COLUMN current_validation_id uuid REFERENCES feedback_validations(id);
