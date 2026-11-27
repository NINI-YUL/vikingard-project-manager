CREATE TABLE actual_time_corrections (
  id uuid PRIMARY KEY,
  managed_version_id uuid NOT NULL REFERENCES managed_versions(id),
  work_item_id uuid NOT NULL REFERENCES work_items(id),
  stage text NOT NULL CHECK (stage IN ('development','test')),
  anchors jsonb NOT NULL CHECK (jsonb_typeof(anchors)='array'),
  start_anchor text,
  end_anchor text,
  fields jsonb NOT NULL CHECK (jsonb_typeof(fields)='object'),
  last_valid jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
  updated_by uuid NOT NULL REFERENCES people(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX actual_time_corrections_version ON actual_time_corrections(managed_version_id,work_item_id);
