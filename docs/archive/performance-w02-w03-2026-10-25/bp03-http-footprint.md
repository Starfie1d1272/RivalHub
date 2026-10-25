# BP-03 complete HTTP comparison

Baseline is main `125dbc9deba5f3c1c189e4435af991d25c8babe2`, including the
season-first global lock protocol and 0096/0097/0098. Candidate changes only
same-request scope/authorization reuse. Both runs use the same opt-in fixture,
Next dev HTTP boundary, fresh local Auth accounts, and isolated PostgreSQL
worker database. Warm each endpoint before taking pg_stat_statements deltas;
never reset shared counters. POST samples assert `receipt.changed === false`.

| Complete request | SELECT before → after | BEGIN / COMMIT (each), unchanged | Returned/affected rows before → after |
| --- | --- | --- | --- |
| Anonymous public GET | 6 → 5 | 1 / 1 | 6 → 5 |
| Authenticated public GET | 9 → 8 | 1 / 1 | 8 → 7 |
| Authenticated public reconcile POST | 15 → 14 | 2 / 2 | 13 → 12 |
| Authorized draft GET | 13 → 9 | 1 / 1 | 9 → 6 |
| Authorized draft reconcile POST | 19 → 15 | 2 / 2 | 14 → 11 |

Counts include the application database's outer authentication/grants, scope,
projection, durable invalidation check and transaction control. The separate
Supabase Auth service database and wire/network bytes are outside this
measurement. This is reproducible query work evidence, not billed usage, TTFB,
LCP or a deployed improvement. The extra scope discovery SELECT introduced by
the global lock protocol is present in **both** compared reconcile runs.

## Exact task disposition

- Same-request GET/reconcile auth and scope: implemented. One match→season JOIN
  preserves competition association validation; a fresh DB-derived authorization
  is passed explicitly through canonical draft visibility and response projection.
  Defaults for other public-season callers stay unchanged, including cached public
  lookup, uncached draft query, super-admin/season-grant policy and explicit null.
- Scope drift: checked against the fresh read snapshot and again after the
  reconcile authority lock, before lifecycle writes. The request context is not
  a browser declaration or a cross-request authorization cache.
- Both representative/captain reads: `loadStartActorsInTx` batches both entries,
  frozen BP representative/current captain and lineup readiness in one SELECT.
- Timing EXISTS/MAX goal: `loadStartTimingInTx` uses one bool_or/MAX aggregate
  for blocker existence and latest relevant completion, preserving DB-derived
  timing and separate test/official scope. It does not fetch all prior matches.
- Final RETURNING: a participant step INSERT returns its actual row and appends
  it to locked steps, including the final reconcile pass. Real PG verifies two
  step reads, one committed step/audit, idempotent duplicate and stale refusal.
- Retained reads/transactions are intentional: the final fresh snapshot cannot
  be replaced by an authorization-time snapshot after a write; locked match and
  database clock samples protect authority and deadlines. No clock or financial
  lock weakening is included.

## Replay

Use the repository's documented local Supabase services (Auth included) and a
local PG instance with pg_stat_statements preloaded. The canonical integration
runner creates/disposes isolated database clones. No production URL is accepted.
Run the opt-in evidence file sequentially, without other traffic to its fixture:

```sh
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 RIVALHUB_BP_HTTP_EVIDENCE=1 BP_FOOTPRINT_LABEL=candidate pnpm test:integration -- tests/integration/db/veto-http-footprint-evidence.test.ts
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 pnpm test:integration -- tests/integration/db/veto-request-scope.test.ts tests/integration/db/veto-read-footprint.test.ts tests/integration/db/veto-reconcile.test.ts
```

To reproduce the baseline, create a detached worktree at the exact baseline SHA,
copy **only** `veto-http-footprint-evidence.test.ts` from this change into the same
test path, perform the frozen dependency install, and run the first command with
`BP_FOOTPRINT_LABEL=baseline`. Do not copy candidate runtime files into baseline.
The evidence test is skipped in ordinary PG CI so it does not implicitly start a
Next server; its opt-in run was executed here. Output aggregate JSON is under
`.agent-tmp/bp-browser/http-footprint-<label>.json`; local credentials and logs
remain private. Domain/permission/scope cases run in ordinary PG CI.
