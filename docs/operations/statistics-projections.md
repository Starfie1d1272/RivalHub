# Statistics projections and egress

Public statistics read versioned per-map sufficient statistics, never immutable
Evidence. Confirmation and recheck materialize projections in the same transaction
as the import and scoreboard. The current projection version is owned by
`src/lib/stats/projection-version.ts`; bump it whenever the reducer, adapter or
serialized representation changes. Formulas remain in `@cs2dak/tournament`.

## Rebuild and release

The active Drizzle migration chain creates the server-only projection table.
The protected Release workflow backfills it and verifies coverage before routing
to a candidate. A reducer-version change triggers the same gate without requiring
a new schema migration. Production mutation must follow [release.md](release.md),
including its environment and target confirmations.

For a local database configured through the canonical local environment:

```bash
pnpm db:stats-projections:backfill
pnpm db:stats-projections:backfill --apply
pnpm db:stats-projections:coverage
```

Backfill defaults to dry-run, examines bounded batches of map identities and reads
only a single current artifact when that projection requires rebuilding. Each map
commits independently; retries skip already-current projections. `--limit N`
bounds eligible maps for a controlled run. Raw source integrity or canonical
validation failure stops the run for investigation instead of publishing a
partial replacement silently. Coverage scans keyset pages in one repeatable-read,
read-only snapshot. Defaults are 50 IDs per page, 10,000 scanned maps and a 60-second
between-map time budget, with PostgreSQL statement timeouts. Missing projections,
query timeouts or `complete=false` all block release; zero observed missing maps
in a truncated scan never means ready. Operators may explicitly increase
`coverage --scan-limit N --batch-size N --max-duration-ms N` after reviewing the
workload; partial reports from different snapshots cannot be combined into ready.
A currently eligible import must have a valid projection. Superseded, rejected, stale-revision and
non-current-profile imports are not eligible. Older projection versions may remain
for rollback but are never selected by a different reducer version.

Production commands are `db:production:stats-projections:backfill` and
`db:production:stats-projections:coverage`. The wrapper requires the normal
production target checks and, for `--apply`,
`RIVALHUB_STATS_PROJECTION_WRITE_CONFIRM=I_UNDERSTAND_STATS_PROJECTION_WRITE`.
The registered repair job checks missing current-version projections periodically,
including writes made by the previous application during release cutover. Its SQL
wake-up does not freeze a reducer version; the application owns candidate selection.
Each invocation claims at most 50 candidate IDs using a persisted, version-scoped
keyset cursor, attempts at most 10 rebuilds, and stops starting maps after 20 seconds.
Each SQL statement is capped at five seconds (or the remaining start budget).
Cursor claims commit before identity/lineage locks; concurrent workers claim ordered
ranges without holding the cursor lock while rebuilding. The cursor wraps on an
empty suffix. Stale, failed, unprocessed and interrupted claims are revisited on
subsequent sweeps, so a stale prefix cannot starve later maps. Progress is a repair
hint, never a coverage assertion. Reports expose claimed `candidates`, actually
`scanned`, outcome counters, `afterMapId`, `wrapped`, `durationMs` and `budgetExhausted`; counters
are per invocation, not whole-database totals. It expires statistics after changes, and quarantines deterministically invalid sources through
the existing recheck owner. Dependency errors remain retryable failures. This also
prevents repeatedly downloading a permanently invalid artifact.

Never bypass the wrapper or run a visitor-triggered rebuild. Production restriction
recovery and billing quota are separate from code deployment.

## Cache and invalidation

Vercel's native Runtime Cache backs `use cache: remote`; local Next uses its local
handler and cannot prove cross-instance reuse. Statistics and compiled historical
benchmarks share the semantic public-statistics tag. Authorized draft queries and
viewer membership/invitation state bypass public caches. Mutations expire the tag
immediately: Server Actions use `updateTag`, HTTP entrypoints use
`revalidateTag(tag, { expire: 0 })`. General metadata may retain its existing SWR
policy. The cache does not replace persisted projections and keys change on deploy.

Identity retirement invalidates all dependent maps, not only the import that
introduced an alias. Scoreboard edits, official scores/rosters, event visibility,
Team linkage, identity merge, Demo transitions and official honors invalidate the
shared public results. Failed dependency reads show an unavailable advanced view
while preserving basic profile information; programming/invariant failures are
not converted to valid zero statistics.

## Acceptance and diagnosis

Use equal, representative windows and compare Supabase Shared Pooler Egress, not
only query duration or database disk size. Query row counts alone do not measure
bytes. `stats.public.read` spans describe actual cache fills; sampled active spans
record `rivalhub.stats.projection_rows`, `projection_json_bytes` and
`unavailable_maps`. JSON bytes are a diagnostic estimate, not wire-byte billing;
source payloads, identities and SQL parameters must never be logged.

Required scenarios:

- Repeated event/player/long-Team/event-Team reads share results, and different
  players share a compiled benchmark. Observe multiple Vercel instances.
- Cold caches, new deployments and missing projections never read raw Evidence
  through public statistics. Missing projections produce incomplete coverage.
- DAK directory, admin list and confirmed-match workbench metadata reads omit
  payload. Review/recheck reads only relevant candidate artifacts.
- Confirmation, replacement, rejection, official corrections, identity retirement,
  account merge and withdrawal of public visibility stop serving the old result.
- Compare old and projected reducer results for sides, transfers, weapons,
  multi-map series, unknown actors, null denominators and existing Rating weights.
- Concurrency, rollback, repeatable reads, migration replay and idempotent backfill
  require real PostgreSQL evidence; unit mocks are not a substitute.

Do not claim production egress reduction from local tests or a warm process alone.
