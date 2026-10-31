# Statistics projections and egress

Public statistics read versioned per-map sufficient statistics, never immutable
Evidence. Confirmation and recheck materialize projections in the same transaction
as the import and scoreboard. The current projection version is owned by
`src/lib/stats/projection-version.ts`; bump it when the reducer, adapter or canonical serialized facts change. The optional
versioned gzip transport sidecar is an additional lossless representation of the
complete performance accumulator; it does not change those facts or formulas and
does not require a reducer-version bump. The complete legacy performance remains
stored for old readers and rollback. Formulas remain in `@cs2dak/tournament`.
Compact record candidates retain all local maxima/ties and round provenance;
map sufficient statistics also support deterministic flash leave-one-map-out.
Equipment candidates require all ten known values and verified freeze-end exporter
semantics. Unverified exporter versions lower economy coverage, never supply zero.
Records/2 also retains every 4K/Ace and classified kill occurrence, per-map event
counts and every player's multi-kill counts. Only exact four/five enemy kills from
Stable/3 playerRounds qualify; TK, suicide and C4/world deaths remain separate.
Utility extrema use single-player, single-round HE plus fire damage. Cumulative
multi-kill leaders sum every map count before selecting ties. Scope aggregates
exclude occurrence arrays in PostgreSQL; event readers reuse current-import,
revision, target and identity checks and select at most 25 occurrences per page
with SQL type/weapon filters. Full events never enter the aggregate remote cache.
The public serializer sends only selected-view summaries and bounded record ties
or event pages. Missing event projections lower coverage rather than imply zero.
Attribute benchmarks select only performance projections and the tournament target
keys needed for validation. They share current-import, identity-binding and target
validation with full statistics reads, within the same read-only snapshot.

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
between-map time budget, with PostgreSQL statement timeouts. Reserved platform/season slug conflicts are reported by the same protected read-only coverage gate and block release; operators resolve them explicitly, never through automatic production renaming. Missing projections,
query timeouts or `complete=false` all block release; zero observed missing maps
in a truncated scan never means ready. Operators may explicitly increase
`coverage --scan-limit N --batch-size N --max-duration-ms N` after reviewing the
workload; partial reports from different snapshots cannot be combined into ready.
A currently eligible import must have a valid projection. Superseded, rejected, stale-revision and
non-current-profile imports are not eligible. Older projection versions remain
for rollback but are never selected by a different reducer version. During the
Records/1 → Records/2 cutover, confirmation and recheck write both versions in the
same transaction; Records/1 retains only its original six candidate kinds, with
no occurrence arrays. Previous application writes are caught by the existing
bounded repair job and the protected pre-routing coverage gate.

For existing projections, use `pnpm db:stats-projections:backfill` only for
reducer rebuilds. The separate transport operation runs through the same target
and write-confirmation checks: use `pnpm exec tsx scripts/db/production-stats-projections.ts transport-backfill`
with optional `--apply`, `--limit N` and `--cursor <nextCursor>`. Local runs use
`pnpm exec tsx scripts/db/run-server-cli.ts scripts/db/stats-projections.ts transport-backfill`.
Dry-run reads only metadata, presence and sizes; `already` means presence, not
verified integrity. Apply independently verifies each existing reducer version,
checks existing sidecars, round-trips new ones and commits one map per transaction.
Apply outcome counts are per projection version; scanned and not-current counts are per map.
It never reads raw Evidence or overwrites a damaged sidecar. Limits are 500 scanned
maps, 150 processed maps and 60 seconds for starting work, with each SQL statement
capped at five seconds; `complete=false` and `nextCursor` require a later run.
Oversized, busy or incompressible maps retain legacy facts. Equivalent sidecar writes
do not invalidate public caches. Deploy compatible readers before applying; rollback
to the old application can retain sidecars because legacy performance remains intact.

Production commands are `db:production:stats-projections:backfill` and
`db:production:stats-projections:coverage`. The wrapper requires the normal
production target checks and, for `--apply`,
`RIVALHUB_STATS_PROJECTION_WRITE_CONFIRM=I_UNDERSTAND_STATS_PROJECTION_WRITE`.
The registered repair job checks missing current-version projections periodically,
including writes made by the previous application during release cutover. Its SQL
wake-up does not freeze a reducer version; the application owns candidate selection.
Each invocation claims at most 50 candidate IDs, one at a time, using a persisted,
version-scoped keyset cursor, attempts at most 10 rebuilds, and stops starting maps
after 20 seconds. Claiming only the next map prevents an unprocessed batch suffix
from being skipped repeatedly when early candidates exhaust the rebuild budget.
Each SQL statement is capped at five seconds (or the remaining start budget).
Cursor claims commit before identity/lineage locks; concurrent workers claim ordered
individual maps without holding the cursor lock while rebuilding. The cursor wraps on an
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
handler and cannot prove cross-instance reuse. Fresh public event membership is read outside the cache and enters normalized platform/event keys; archived public events remain eligible and withdrawn drafts cannot reuse the previous aggregate. Statistics and compiled historical
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

## Protected transport backfill runner

The manually dispatched `Statistics transport backfill` workflow runs one bounded
batch under the production environment and release-lineage then production-state
locks. Dispatch only from current `main` with successful exact-SHA main push CI;
the runner verifies the canonical deployed tag/commit, checks out that commit in a
separate worktree, installs its frozen dependencies and rechecks production identity
before invoking the existing protected wrapper. The database secret is available
only to the execution step. No host CLI or SSH access is required.

Choose `dry` or `apply`, a positive `limit` (at most 500 for dry and 150 for apply),
and an optional cursor. Start the first dry and first apply with an empty cursor:
a dry-run cursor must never be used as the first apply cursor. Resume each partial
apply with its last successful apply `nextCursor`; if that is null while incomplete,
retain the input cursor as `resumeCursor`. `complete=false` is partial. An invalid
sidecar stops the run; investigate it rather than skipping or overwriting it. If a
run fails without a report, repeat from the last saved cursor. Each map commits
independently, so already committed maps are revalidated on retry.

The dry run reports sidecar presence and sizes without decoding; apply validates
existing sidecars. `scanned` counts maps; apply `encoded`, `already` and
`legacy_retained` count projection versions. Dry and apply byte figures use different
representations and are not wire or billing measurements. Reverting to a legacy
application does not require deleting the optional sidecar or the complete legacy
performance facts.

### Tournament transport backfill

Tournament transport is an additional lossless representation; full legacy tournament and
performance facts remain stored. Full tournament reads select one representation, while
identity-only reads retain the small legacy projection. A present invalid sidecar fails
closed. Rolling back the application needs no database rollback; an older writer may remove
the sidecar while retaining the legacy facts.

After deploying a version that includes tournament transport backfill, use the existing
protected workflow with an empty cursor for a fresh dry run and then an empty cursor for
the first apply. The previous performance-only cursor does not cover tournament. Confirm
the deployed release has this capability before running; a report without tournament fields
is from an older implementation and does not establish tournament coverage. Subsequent
apply batches use the preceding successful apply cursor.

The report's tournamentEncoded, tournamentAlready, tournamentLegacyRetained,
tournamentOriginalBytes and tournamentEncodedBytes are per projection row / representation
on apply, and current-row inventory on dry run. missingPrevious counts maps whose previous
projection is absent on apply; it does not create that projection. scanned counts maps.
Dry-run inventory does not verify contents; complete means the candidate scan ended, not
that every row was encoded. Byte counts are representation sizes, not billed traffic.
