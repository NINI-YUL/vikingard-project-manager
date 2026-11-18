CREATE TABLE source_bindings (
  source_project_id uuid PRIMARY KEY REFERENCES source_projects(id),
  organization_id text NOT NULL,
  category_field_id text NOT NULL,
  function_field_id text NOT NULL,
  type_names jsonb NOT NULL,
  status_names jsonb NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE work_items ADD COLUMN source_status_id text;