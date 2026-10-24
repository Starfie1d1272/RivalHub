# Public team match facts across seasons

`getPublicEventTeamMatchFactsBatch(scopes: readonly {seasonId: string; entryIds: readonly string[]}[]): Promise<Map<string, Map<string, PublicEventTeamMatchFacts>>>` is exported by `src/lib/competition-entries/public-team-context.ts`. Each outer key is a requested season; duplicate scopes union entry IDs for that season. Empty scopes retain an empty inner map; every requested entry retains an empty record/list when no eligible match exists. The existing single-season function delegates to this batch owner, and the summary-only consumer still omits display-map and opponent-name work.

The match predicate keeps each season paired with its own target entry set, rather than crossing all season IDs with all entry IDs. Only official/non-test matches are read. One shared BO1 display-score batch follows the scoped match query, then one canonical public opponent-identity batch. Matches retain completedAt/scheduledAt/id ascending order within each season. Existing per-side official/display scores, forfeit/omitted handling, record calculations and reviewed-replacement public identities are projected by their original owners. Callers still provide already-public season/entry scopes; this server-only helper does not introduce a new authorization surface or cache.

Four PostgreSQL cases cover three-season equivalence, both score orientations, sorting, empty records, duplicate/empty/foreign scopes, test exclusion, retained approved identity during replacement review, non-public opponents, forfeits and omitted results. A frozen EventRoster's approved-source constraint remains enforced; tests use legal entry states rather than clearing a required approved revision.

The exact original reader from public-entrypoint head `4ec876585b38d18792a2d88cca711ff85118505a` was loaded for the A/B. For three seasons, each containing one current BO3 and one completed BO1 with a completed 13:7 map, SELECTs decreased 9→3; returned rows stayed 15. PG result JSON bytes increased 1743→1971 because the combined match query must return seasonId to route facts safely. This is a round-trip reduction with an explicit 228-byte fixture tradeoff, not a byte-volume, production latency or pool/concurrency improvement claim.

Normal correctness:

```bash
source /workspace/.onboarding/activate.sh
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 pnpm test:integration tests/integration/db/public-team-facts-batch.test.ts
```

Exact original baseline (temporary source is ignored):

```bash
mkdir -p .agent-tmp
git show 4ec876585b38d18792a2d88cca711ff85118505a:src/lib/competition-entries/public-team-context.ts > .agent-tmp/public-team-context-baseline.ts
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 RIVALHUB_TEAM_FACTS_BASELINE="$PWD/.agent-tmp/public-team-context-baseline.ts" pnpm test:integration tests/integration/db/public-team-facts-batch.test.ts
```

Only the shared owner and tests change here. The statistics owner connects `teams/profile-read-model.ts` separately after this API is reviewed; the frozen public-entrypoint PR remains unchanged.
