-- Independent product telemetry D1, never application PostgreSQL or Mizar storage.
CREATE TABLE batches (
  ticket TEXT NOT NULL, id TEXT NOT NULL, received INTEGER NOT NULL, expires INTEGER NOT NULL,
  day TEXT NOT NULL, account TEXT, session TEXT NOT NULL, role TEXT NOT NULL,
  release TEXT NOT NULL, environment TEXT NOT NULL, bytes INTEGER NOT NULL,
  events_gzip BLOB NOT NULL, summary TEXT NOT NULL,
  PRIMARY KEY(ticket, id)
) WITHOUT ROWID;
CREATE INDEX batches_account ON batches(account, received);
CREATE INDEX batches_session ON batches(session, received);
CREATE INDEX batches_dashboard_received ON batches(environment, received DESC, ticket DESC, id DESC);
CREATE INDEX batches_expiry ON batches(expires);
CREATE INDEX batches_ticket_received ON batches(ticket, received);
CREATE TABLE usage (day TEXT PRIMARY KEY, batches INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0) WITHOUT ROWID;
CREATE TABLE summaries (
  day TEXT NOT NULL, release TEXT NOT NULL, environment TEXT NOT NULL, role TEXT NOT NULL,
  scene TEXT NOT NULL, route TEXT NOT NULL, kind TEXT NOT NULL, operation TEXT NOT NULL,
  phase TEXT NOT NULL, outcome TEXT NOT NULL, variant TEXT NOT NULL, events INTEGER NOT NULL, duration_ms INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  PRIMARY KEY(day, release, environment, role, scene, route, kind, operation, phase, outcome, variant)
) WITHOUT ROWID;
CREATE INDEX summaries_expiry ON summaries(expires);

CREATE TABLE rollups(day TEXT PRIMARY KEY) WITHOUT ROWID;
