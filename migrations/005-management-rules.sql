CREATE TABLE management_state (
  id integer PRIMARY KEY CHECK(id=1), revision integer NOT NULL DEFAULT 1 CHECK(revision>0)
);
INSERT INTO management_state(id) VALUES(1);
CREATE TABLE management_rules (
  scope text NOT NULL CHECK(scope IN ('system','version','requirement')),
  scope_key text NOT NULL, values jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(scope,scope_key)
);
CREATE TABLE calendar_days (
  day date PRIMARY KEY, working boolean
);
CREATE TABLE status_mappings (
  source_project_id uuid NOT NULL REFERENCES source_projects(id),
  status_id text NOT NULL, semantic text CHECK(semantic IN ('not_started','developing','testing','processing','paused','delivered','non_delivery')),
  markers jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  recovery text NOT NULL DEFAULT 'pending' CHECK(recovery IN ('pending','verified')),
  PRIMARY KEY(source_project_id,status_id)
);
CREATE TABLE function_exemptions (
  requirement_id uuid NOT NULL REFERENCES work_items(id), function_name text NOT NULL,
  confirmed_by uuid NOT NULL REFERENCES people(id), confirmed_at timestamptz NOT NULL DEFAULT now(),
  applicable boolean NOT NULL DEFAULT false,
  PRIMARY KEY(requirement_id,function_name)
);
ALTER TABLE source_bindings ADD COLUMN status_definitions jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE TABLE plan_baselines (
  work_item_id uuid PRIMARY KEY REFERENCES work_items(id),
  planned_start_at timestamptz, planned_due_at timestamptz,
  confirmed_by uuid NOT NULL REFERENCES people(id), confirmed_at timestamptz NOT NULL DEFAULT now(),
  evidence text NOT NULL, source_synced_at timestamptz NOT NULL
);
