CREATE TABLE people (
  id uuid PRIMARY KEY,
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 100),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE identity_mappings (
  person_id uuid PRIMARY KEY REFERENCES people(id),
  corp_id text NOT NULL,
  union_id text NOT NULL,
  confirmed boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  UNIQUE(corp_id, union_id)
);
CREATE TABLE access_grants (
  person_id uuid PRIMARY KEY REFERENCES people(id),
  role text NOT NULL CHECK (role IN ('none', 'viewer', 'admin', 'owner')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES people(id)
);
CREATE TABLE login_sessions (
  digest text PRIMARY KEY,
  person_id uuid NOT NULL REFERENCES people(id),
  csrf text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX ON login_sessions(person_id);
CREATE TABLE oauth_requests (
  digest text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
CREATE TABLE security_state (
  id integer PRIMARY KEY CHECK (id = 1),
  initialized boolean NOT NULL DEFAULT false
);
INSERT INTO security_state(id) VALUES (1);
CREATE TABLE audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid REFERENCES people(id),
  subject_id uuid REFERENCES people(id),
  action text NOT NULL,
  before_value jsonb,
  after_value jsonb,
  reason text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
