-- Bounded identity-free database traffic windows; retained for seven days.
CREATE TABLE db_traffic_batches (
  id TEXT PRIMARY KEY, at INTEGER NOT NULL, process TEXT NOT NULL,
  release TEXT NOT NULL, deployment TEXT NOT NULL, payload TEXT NOT NULL, expires INTEGER NOT NULL, dropped INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX db_traffic_at ON db_traffic_batches(at);
CREATE INDEX db_traffic_expiry ON db_traffic_batches(expires);

CREATE TABLE db_traffic_usage (day TEXT PRIMARY KEY, batches INTEGER NOT NULL) WITHOUT ROWID;
