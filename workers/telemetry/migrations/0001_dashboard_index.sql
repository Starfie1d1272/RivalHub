-- Existing D1 only: additive and repeatable; never replay schema.sql on a live database.
CREATE INDEX IF NOT EXISTS batches_dashboard_received ON batches(environment, received DESC, ticket DESC, id DESC);
