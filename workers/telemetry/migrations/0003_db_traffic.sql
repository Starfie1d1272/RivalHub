-- Bounded identity-free database traffic windows; retained for seven days.
CREATE TABLE db_traffic_batches (
  id TEXT PRIMARY KEY, at INTEGER NOT NULL, process TEXT NOT NULL,
  release TEXT NOT NULL, deployment TEXT NOT NULL, payload TEXT NOT NULL, expires INTEGER NOT NULL, dropped INTEGER NOT NULL, received_bytes INTEGER NOT NULL, connections INTEGER NOT NULL, observed_connections INTEGER NOT NULL, processed INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
CREATE INDEX db_traffic_at ON db_traffic_batches(at);
CREATE INDEX db_traffic_expiry ON db_traffic_batches(expires);
CREATE INDEX db_traffic_pending ON db_traffic_batches(processed, at, id);
CREATE TABLE db_traffic_hours (hour INTEGER PRIMARY KEY, version INTEGER NOT NULL, payload TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE INDEX db_traffic_hours_expiry ON db_traffic_hours(expires);

CREATE TABLE db_traffic_usage (day TEXT PRIMARY KEY, batches INTEGER NOT NULL) WITHOUT ROWID;

CREATE TABLE db_offline_runs (consumer TEXT NOT NULL, run TEXT NOT NULL, started INTEGER NOT NULL, ended INTEGER NOT NULL, release TEXT NOT NULL, payload TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(consumer,run)) WITHOUT ROWID;
CREATE INDEX db_offline_ended ON db_offline_runs(ended);
CREATE INDEX db_offline_expiry ON db_offline_runs(expires);
