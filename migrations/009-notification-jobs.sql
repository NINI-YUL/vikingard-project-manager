CREATE TABLE notification_jobs (
  id uuid PRIMARY KEY,
  work_item_id uuid NOT NULL REFERENCES work_items(id),
  kind text NOT NULL CHECK(kind IN ('initial','reminder')),
  recipient_person_id uuid NOT NULL REFERENCES people(id),
  recipient_union_id text NOT NULL,
  form_url text NOT NULL,
  due_at timestamptz,
  status text NOT NULL CHECK(status IN ('planned','cancelled','sent','unknown')),
  source_key text NOT NULL,
  planned_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  cancelled_at timestamptz,
  cancel_reason text,
  UNIQUE(work_item_id,kind,recipient_person_id,source_key)
);
CREATE TABLE notification_attempts (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES notification_jobs(id),
  attempted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  result text NOT NULL CHECK(result IN ('sent','failed','unknown')),
  provider_ref text,
  detail text
);
CREATE INDEX notification_jobs_due ON notification_jobs(status,due_at);
