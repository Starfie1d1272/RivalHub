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
-- Product history: short-lived deduplication and identity-free daily distributions.
CREATE TABLE history_state (
  id INTEGER PRIMARY KEY CHECK(id=1), started_at INTEGER NOT NULL,
  cursor_received INTEGER NOT NULL, cursor_ticket TEXT NOT NULL, cursor_id TEXT NOT NULL,
  last_run INTEGER NOT NULL, paused_at INTEGER
);
CREATE TABLE history_samples (
  sample_key TEXT PRIMARY KEY, day TEXT NOT NULL, kind TEXT NOT NULL, dimensions TEXT NOT NULL,
  latest_at INTEGER NOT NULL, received INTEGER NOT NULL, expires INTEGER NOT NULL, closes INTEGER NOT NULL,
  has_start INTEGER NOT NULL, phase TEXT NOT NULL, value REAL, bucket INTEGER NOT NULL,
  active REAL, active_bucket INTEGER NOT NULL, client_covered INTEGER NOT NULL, enhanced_covered INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX history_samples_day ON history_samples(day);
CREATE INDEX history_samples_expiry ON history_samples(expires);
CREATE TABLE history_days (
  day TEXT PRIMARY KEY, payload TEXT NOT NULL, complete INTEGER NOT NULL, sealed INTEGER NOT NULL,
  captured_at INTEGER NOT NULL, expires INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX history_days_expiry ON history_days(expires);
CREATE TABLE history_gaps (day TEXT PRIMARY KEY, expires INTEGER NOT NULL) WITHOUT ROWID;
-- Bounded identity-free database traffic windows; retained for seven days.
CREATE TABLE db_traffic_batches (
  id TEXT PRIMARY KEY, at INTEGER NOT NULL, process TEXT NOT NULL,
  release TEXT NOT NULL, deployment TEXT NOT NULL, payload TEXT NOT NULL, expires INTEGER NOT NULL, dropped INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX db_traffic_at ON db_traffic_batches(at);
CREATE INDEX db_traffic_expiry ON db_traffic_batches(expires);

CREATE TABLE db_traffic_usage (day TEXT PRIMARY KEY, batches INTEGER NOT NULL) WITHOUT ROWID;
