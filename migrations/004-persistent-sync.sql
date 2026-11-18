ALTER TABLE source_sync_states ADD COLUMN next_due_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE source_sync_states ADD COLUMN failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0);
ALTER TABLE work_items ADD COLUMN source_presence text NOT NULL DEFAULT 'current' CHECK (source_presence IN ('current','archived','out_of_scope','access_restricted','missing_unknown','deleted_confirmed'));
ALTER TABLE work_items ADD COLUMN presence_checked_at timestamptz;
ALTER TABLE work_items ADD COLUMN executor_source_id text;
ALTER TABLE work_items ADD COLUMN participant_source_ids jsonb;
ALTER TABLE work_items ADD COLUMN planned_start_at timestamptz;
ALTER TABLE work_items ADD COLUMN planned_due_at timestamptz;
ALTER TABLE work_items ADD COLUMN source_completed_at timestamptz;
ALTER TABLE work_items ADD COLUMN source_is_done boolean;
ALTER TABLE work_items ADD COLUMN fact_digest text;
ALTER TABLE work_items ADD COLUMN history_status text NOT NULL DEFAULT 'unread' CHECK (history_status IN ('unread','visible_read'));
CREATE TABLE source_activities (
  source_project_id uuid NOT NULL REFERENCES source_projects(id),
  source_task_id text NOT NULL,
  source_activity_id text NOT NULL,
  revision_hash text NOT NULL,
  action text NOT NULL,
  occurred_at timestamptz NOT NULL,
  source_updated_at timestamptz,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  raw_source jsonb NOT NULL,
  PRIMARY KEY(source_project_id,source_task_id,source_activity_id,revision_hash)
);
CREATE TABLE source_observations (
  id uuid PRIMARY KEY,
  work_item_id uuid NOT NULL REFERENCES work_items(id),
  observed_at timestamptz NOT NULL DEFAULT now(),
  source_updated_at timestamptz,
  facts jsonb NOT NULL
);
CREATE INDEX source_observations_task_time ON source_observations(work_item_id,observed_at);