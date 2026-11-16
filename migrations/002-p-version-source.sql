CREATE TABLE source_projects (
  id uuid PRIMARY KEY,
  corp_id text NOT NULL CHECK (length(corp_id) BETWEEN 1 AND 200),
  teambition_project_id text NOT NULL UNIQUE CHECK (length(teambition_project_id) BETWEEN 1 AND 100),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
  config_version integer NOT NULL DEFAULT 1 CHECK (config_version > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE managed_versions (
  id uuid PRIMARY KEY,
  source_project_id uuid NOT NULL REFERENCES source_projects(id),
  source_version_id text NOT NULL CHECK (length(source_version_id) BETWEEN 1 AND 100),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
  owner_id uuid REFERENCES people(id),
  lifecycle text NOT NULL DEFAULT 'enrolled' CHECK (lifecycle IN ('enrolled','stopped','ended')),
  sync_start_at timestamptz NOT NULL DEFAULT now(),
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  stopped_at timestamptz,
  stop_reason text,
  UNIQUE(source_project_id, source_version_id)
);
CREATE TABLE tracking_periods (
  id uuid PRIMARY KEY,
  managed_version_id uuid NOT NULL REFERENCES managed_versions(id),
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500)
);
CREATE UNIQUE INDEX tracking_periods_one_open ON tracking_periods(managed_version_id) WHERE ended_at IS NULL;
CREATE TABLE source_sync_states (
  managed_version_id uuid PRIMARY KEY REFERENCES managed_versions(id),
  cursor text,
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  last_status text NOT NULL DEFAULT 'never' CHECK (last_status IN ('never','running','succeeded','failed')),
  last_error_code text,
  last_error_detail text
);
CREATE TABLE source_sync_runs (
  id uuid PRIMARY KEY,
  managed_version_id uuid NOT NULL REFERENCES managed_versions(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('running','succeeded','failed')),
  imported_count integer NOT NULL DEFAULT 0 CHECK (imported_count >= 0),
  error_code text,
  error_detail text
);
CREATE TABLE work_items (
  id uuid PRIMARY KEY,
  managed_version_id uuid NOT NULL REFERENCES managed_versions(id),
  source_task_id text NOT NULL,
  visible_key text,
  title text NOT NULL,
  type_id text,
  type_name text,
  category text,
  function_name text,
  parent_source_task_id text,
  parent_missing boolean NOT NULL DEFAULT false,
  raw_status text,
  availability text NOT NULL DEFAULT 'available' CHECK (availability IN ('available','unknown','incomplete')),
  structure_issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_updated_at timestamptz,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  raw_source jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(managed_version_id, source_task_id)
);
CREATE INDEX work_items_version_parent ON work_items(managed_version_id, parent_source_task_id);