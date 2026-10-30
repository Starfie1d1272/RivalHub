-- Separate quarantined records from trusted batches; seven-day bounded retention.
CREATE TABLE db_traffic_receipts (
  id TEXT PRIMARY KEY, digest TEXT NOT NULL, status TEXT NOT NULL,
  at INTEGER NOT NULL, release TEXT NOT NULL, deployment TEXT NOT NULL,
  payload TEXT, reasons TEXT, expires INTEGER NOT NULL, processed INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
CREATE INDEX db_traffic_receipts_expiry ON db_traffic_receipts(expires);
CREATE INDEX db_traffic_receipts_pending ON db_traffic_receipts(status, processed, at, id);
CREATE TABLE db_traffic_quality_hours (hour INTEGER PRIMARY KEY, version INTEGER NOT NULL, payload TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE INDEX db_traffic_quality_hours_expiry ON db_traffic_quality_hours(expires);
