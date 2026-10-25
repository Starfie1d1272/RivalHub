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
