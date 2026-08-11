# Legacy Migration Chain (pre-2.0, frozen)

This directory is the RivalHub **pre-2.0 / pre-adoption historical migration chain** (0000–0020), frozen verbatim for archaeology and audit.

- This chain has been proven **not reliably replayable from an empty PostgreSQL**:
  `0007_advance_to_advance_tiers.sql` calls `jsonb_typeof(stage_plan)` / `jsonb_array_elements(stage_plan)` on a `json` column, which fails deterministically (`function jsonb_typeof(json) does not exist`) on a fresh database.
- The journal `when` timestamps are historically **non-monotonic** and must not be reused as the active migrator history.
- Legacy files are preserved **unchanged**; modifying legacy migrations to "fix history" is forbidden.
- The **active** migration chain lives in `drizzle/migrations/` (2.0 baseline: `0000_v2_baseline` → `0001_canonical_team_identity` → …).
