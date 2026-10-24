# Public entrypoints performance implementation evidence

Code baseline: `4ebecf5d5e1b629371c7d0c8851b6bab9c31d7f8` (#1081 retained).
This is implementation and isolated-fixture evidence. No production mutation, deployment, LCP improvement or CLS budget attainment is claimed.

## Implemented surfaces

- Match detail: scoped batch entry lookup; finished/cancelled phase fast path; no unused time proposals for spectators or completed matches. Scoreboard, default advanced player detail, MVP, lineup careers and scouting follow independent dependencies. Default advanced content still loads automatically. Same request/player/map detail is deduplicated.
- Schedule: frozen stage directory resolves URL `stage`; only the selected stage's matches, Swiss/provider projection, BO1 display maps and applicable round-robin round scores are read/serialized. Team highlighting is retained across stage links. Play-in supplied facts are re-scoped to event/run/manual ownership.
- Public match refresh: visible 15-second single-statement fingerprint checks replace unconditional RSC refresh. Changes to local results/maps, veto, live phase, stage membership, lineup, public identity/sanction, scoreboard/import verification trigger canonical refresh. It is not an authorization token or business revision. Auxiliary/global facts fully resync within two minutes. Every action checks event visibility and detail match membership; no shared viewer cache or writes.
- Home/event overview: stage/draft and existing home projection start together. Announcement/info and historical full results stream separately from event Hero. Main-event initialization skips unused qualification progress. Existing participant and frozen-stage owners retain the official population definitions.
- Directory/home compact results: batch canonical champion/vacancy/final selection, SQL totals/latest completion and only final-stage candidate facts. Full results retain placements, honors/history and adjudications. Historical directory pages contain at most 12 events, with separate active/history boundaries.
- Announcements: latest event query is limited to one; history pages contain 20 complete bodies plus a one-row continuation probe. Existing public visibility, order and invalidation tags are retained; admin readers are unchanged.
- Community awards: no initial candidate/match options for any viewer. Authenticated evidence dialogs load options on mount through a fresh guarded action and expose retry on failure. Recipient/submitter public identity resolution is combined; match labels use both scoped entry aliases in one SELECT. Mutation qualification/visibility rules are unchanged.
- Info: groups/contacts parallelize inside the existing public cache, draft authorization stays outside it. Public info/captains/draft use the documented `io()` boundary.
- Captains: public candidate content precedes viewer qualification; approved membership is reused instead of rereading registration. Polling reads a bounded public/viewer DTO, no RSC refresh while voting continues. Ending voting forces canonical refresh and stops polling.
- Draft: archive/completed views skip the unused player pool. Live public reads use one read-only RR snapshot and exclude picked/captain registrations in SQL. Spectator polling updates public DTOs, retaining a canonical refresh for lifecycle/pause/completion changes. Notification overlay and explicit pre-match collapse controls avoid those automatic layout changes.

## Validation and reproducible evidence

Focused app/tests type checks, changed-file ESLint and architecture contract pass. Real PostgreSQL suites exercised community award outcome/privacy/capability, announcement publish/withdraw/draft isolation, public info permissions, test-match exclusion, canonical formation identity and the new read-footprint/scope cases. Component tests cover unchanged/hidden/recovered match polling, readonly draft preview/archive/completion, and captain voting termination. BO1 display-score and bracket projection tests pass.

The new `tests/integration/db/public-entrypoint-performance.test.ts` protects canonical summary equivalence, revoked champion vacancy, complete stable announcement pagination, map/roster token changes, empty scopes and supplied Play-in event/run scoping. Unit action tests cover invalid/hidden/cross-event inputs and fresh form authorization.

Ten alternating A/B runs use the exact original result module from the baseline, two isolated events, 20 finished matches per event and 12 manual honors per event, plus a revoked champion. Baseline: 10 SELECT / 69 rows / 18,444 JSON bytes. Candidate: 4 SELECT / 7 rows / 688 JSON bytes. Raw runs and candidate source hash are in `2026-10-25-public-entrypoints-read-evidence.json`. Durations are local diagnostics with concurrent development activity; neither SQL JSON bytes nor document TTFB measure browser LCP. No transaction/pool/mixed-load improvement is inferred.

Reproduce normal correctness and read-footprint comparison:

```bash
source /workspace/.onboarding/activate.sh
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 pnpm test:integration tests/integration/db/public-entrypoint-performance.test.ts
```

Reproduce against the exact original result module (temporary source remains ignored):

```bash
mkdir -p .agent-tmp
git show 4ebecf5d:src/lib/seasons/public-results.ts > .agent-tmp/public-results-baseline.ts
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 RIVALHUB_PUBLIC_RESULTS_BASELINE="$PWD/.agent-tmp/public-results-baseline.ts" pnpm test:integration tests/integration/db/public-entrypoint-performance.test.ts
```

No supplied research scripts or raw private evidence are committed. The attachment manifest was checked: 48 files, zero hash mismatches.

## Task/route state matrix

The final column is an explicit remaining experiment, not a claim that implementation alone closes user-perceived performance.

| Tasks / route | State | Evidence or next specific experiment |
| --- | --- | --- |
| M-D1, match core | Implemented/tested | Scoped batch; BO1 projection and official/test fixtures; browser role matrix remains part of integrated acceptance |
| M-D2, match content | Experiment required | Independent auto-loading code compiles; DAK fixture must record scoreboard/default-player/MVP and scouting/lineup timestamps separately |
| M-D3, viewer controls | Implemented/tested | Form transport auth unit tests and public DB invariants; scheduled captain/admin browser operations remain required |
| M-D5, scouting | Implemented/tested | Independent opponent/profile reads; per-team historical denominator owner unchanged |
| M-U1, detail CLS | Experiment required | Fixed BET slot/grid, unified route fallback and manual collapse implemented; desktop/mobile Major live arrival/loss/BET shift-source trace required |
| M-R1/S-4, background refresh | Experiment required | Real PG token changes and component cadence passed; isolated 20-visible-tab + BP workload must measure SQL/pool/BP p95 before budget closure |
| S-1/S-2, current stage | Implemented/tested | Frozen directory + scoped SQL + real supplied Play-in positive/negative cases; BO1 remains canonical |
| S-3, schedule navigation | Experiment required | URL links retain team scope; production direct/prefetch/back/forward/current-stage payload and ready trace required |
| O-1, event home | Implemented/tested | Auxiliary/sidebar/results removed from Hero wait; registration/playing/history/draft browser role matrix remains integrated acceptance |
| O-2, official summaries | Hypothesis rejected | Existing canonical Major overview is already narrow; no replacement population/count model introduced |
| O-3/O-4/I-1, overview/info | Implemented/tested | No qualification progress after main initialization; info permission/cache lifecycle PG passed |
| O-U/I-2, overview/info layout | Experiment required | Existing image dimensions retained; mobile/long-label and late personal-next-step CLS trace required |
| H-1, `/` | Implemented/tested | Stage/draft/projection dependency removed; empty catalog remains supported |
| H-2, home cache key | Experiment required | Existing remote cache preserved; instrument hit/miss/fill and unrelated catalog edits before changing key semantics |
| H-3/R-1/R-2, resources/rules | Hypothesis rejected / experiment required | Rule body is local cached Markdown, no new DB/cache/wording changes. Production font/CSS/LCP-element trace still needed before resource changes |
| D-1/D-2/D-3, `/seasons` | Implemented/tested | Batched compact results, aggregate counts and bounded history; exact baseline A/B and canonical vacancy tests above |
| C-1/C-2, community awards | Implemented/tested | Initial options removed, guarded lazy read and identity batch; real outcome/privacy/capability PG passed |
| C-U, awards layout | Experiment required | Dialog uses a stable loading/error state; logged-in open/retry/mobile layout smoke still required |
| P-CAPTAINS | Implemented/tested | Separate public/viewer boundary and narrow polling; component termination test; voter mutation rules unchanged |
| P-DRAFT | Implemented/tested | No pool in archive/complete, public RR snapshot, SQL exclusion and narrow polling; canonical formation PG and readonly component tests |
| P-ANNOUNCEMENTS | Implemented/tested | Stable complete-body paging, latest limit, draft filtering and lifecycle PG |

## Shared contracts and rollback

`match/primary` must represent the complete core, never a skeleton. `match/advanced` is reserved for the default selected player's detailed statistics only; it does not mean all advanced modules are ready. Lineup careers and scouting require separate local stage spans. `match/form` denotes the MVP panel. `schedule/primary` means the complete selected stage. ContentReady integration waits for the shared telemetry dependency; no production measurement flag is enabled here. The stats owner's narrow MVP API replaces the existing cached player-detail consumer when available; no stats aggregation is duplicated.

No cache tags, withdrawal hard-expire policy, deadline, lock mode, money handling, frozen rule snapshot or mutation retry behavior changes. Rollback is application-only: reverting these consumers/readers restores the previous reads; no schema or data rollback is required. Captains/draft and match action readers are fresh and uncached. Remaining production build, protected CI, mixed-load/browser evidence, merge and release belong to the coordinating parent.
