# Public entrypoints performance implementation evidence

Code baseline: `4ebecf5d5e1b629371c7d0c8851b6bab9c31d7f8` (#1081 retained).
This is implementation and isolated-fixture evidence. No production mutation, deployment, LCP improvement or CLS budget attainment is claimed.

## Implemented surfaces

- Match detail: scoped batch entry lookup; finished/cancelled phase fast path; no unused time proposals for spectators or completed matches. Scoreboard, default advanced player detail, MVP, lineup careers and scouting follow independent dependencies. Default advanced content still loads automatically. Same request/player/map detail is deduplicated.
- Schedule: frozen stage directory resolves URL `stage`; only the selected stage's matches, Swiss/provider projection, BO1 display maps and applicable round-robin round scores are read/serialized. Stage/history links explicitly disable viewport and hover prefetch so unopened stages/pages do not trigger eager reads. Team highlighting is retained across stage links. Play-in supplied facts are re-scoped to event/run/manual ownership.
- Public match refresh: visible 15-second single-statement fingerprint checks replace unconditional RSC refresh. The first poll establishes a token before starting one canonical RSC refresh, so an SSR/token race cannot hide a concurrent change. Subsequent changes to local results/maps, veto, live phase, stage membership, lineup, public identity/sanction, scoreboard/import verification trigger canonical refresh. It is not an authorization token or business revision. Auxiliary/global facts fully resync within two minutes. Every action checks event visibility and detail match membership; no shared viewer cache or writes.
- Home/event overview: stage/draft and existing home projection start together. Announcement/info, historical full results, voting/draft highlights and standings stream separately from event Hero. Main-event initialization skips unused qualification progress. Existing participant and frozen-stage owners retain the official population definitions.
- Directory/home compact results: batch canonical champion/vacancy/final selection, SQL totals/latest completion and only final-stage candidate facts. Full results retain placements, honors/history and adjudications. Historical directory pages contain at most 12 events, with separate active/history boundaries.
- Announcements: latest event query is limited to one; history pages contain 20 complete bodies plus a one-row continuation probe. Existing public visibility, order and invalidation tags are retained; admin scope rules remain unchanged.
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

Seven-route Chromium smoke on a dedicated migrated local database passed: rules, directory, announcements, event home, schedule, finished BO1 detail and anonymous community awards. Stage links retained team highlighting and back navigation; 390px viewport had no document overflow and no page exceptions. The attached browser JSON records compile-inclusive dev timings only. Cold dev compilation timeouts and the initial stale shared local schema are not presented as browser latency evidence. Production prefetch, DAK/player/MVP and live/BET CLS matrices remain pending.

Shared administrator APIs added for the backend consumers: `listSeasonPublicInfoAdminSummaries(role, seasonIds)` returns `{season,groupCount,contactCount}[]` (counts include closed groups); `getSeasonPublicInfoAdmin` reads one authorized season directly. `listAnnouncementAdminSummaries({...filters,page?,pageSize?})` returns `{items,total,page,pageSize}`, with `items: Omit<AnnouncementAdminRow,"body">[]`, default page size 20 and maximum 100. `getAnnouncementForAdmin(id,{role,seasonIds,seasonId?,status?,scope?})` performs a direct ID + authorization/scope query. Existing list functions remain compatible. Real PG tests cover empty grants, foreign-event rejection, closed-group counts, draft detail visibility and omission of body from summaries.

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

`public/primary` on the home/event overview covers the Hero and primary entry/current-match facts, not asynchronous sidebars, historical results or auxiliary highlights. `match/primary` must represent the complete core, never a skeleton. `match/advanced` is reserved for the default selected player's detailed statistics only; it does not mean all advanced modules are ready. Lineup careers and scouting require separate local stage spans. `match/form` denotes the MVP panel. `schedule/primary` means the complete selected stage. ContentReady uses the merged telemetry dependency; no production measurement flag is enabled here. The MVP panel consumes the stats owner's `getPublicMatchMvpSummary` API from #1087; that PR remains an explicit integration dependency and no stats aggregation is duplicated. `schedule/primary` is emitted after the imperative bracket render and interaction binding when a bracket is present; other current-stage views emit beside their complete content. A component test holds the render promise to prevent premature readiness.

No cache tags, withdrawal hard-expire policy, deadline, lock mode, money handling, frozen rule snapshot or mutation retry behavior changes. Rollback is application-only: reverting these consumers/readers restores the previous reads; no schema or data rollback is required. Captains/draft and match action readers are fresh and uncached. Remaining production build, protected CI, mixed-load/browser evidence, merge and release belong to the coordinating parent.

## Review regression coverage

Directory pagination applies only to recent/archived history. Upcoming registration entries remain a complete independent lifecycle group on every history page, including when the active group is empty. A pure directory test covers a future unopened registration, 13 historical events, page bounds and complete reachability.

The three narrow poll consumers discard pending responses after visibility, enabled-state or event-scope changes. Recovery queues a fresh check after any obsolete request finishes, without overlapping reads. The legacy zero-argument polling callback remains compatible with optional UI flags used by other consumers. Twelve component tests cover those transitions, the compatibility boundary and bootstrap/full-resync timing. There is no SSR initial token paired with potentially older core facts: the first successful token is captured before an unconditional refresh. The full-resync clock starts at that actual refresh (first check at 15 seconds, unchanged checks through 120 seconds from mount, next full refresh at 135 seconds). A real PostgreSQL commit between captured core facts and token read plus the controlled component test protects that read-gap case.

An independent bounded mismatch query preserves the schedule warning for unowned Play-in matches; only a correctly linked qualification run is excluded. Six real PostgreSQL performance/scope tests pass after these changes. BET polling compatibility and draft/captain terminal-state tests also pass. These checks do not replace the pending mixed-load or browser CLS measurements above.

## Season layout slot evidence

The season layout reserves one small viewport of minimum content height outside its Suspense boundary. The previous half-viewport fallback exposed the footer before long content arrived; the resolved layout did not share its geometry. Short pages retain the same viewport slot, long pages grow naturally, and the footer stays in normal document flow. No footer styles, visibility or positioning change, but its document coordinates do change. The candidate places the initial footer below the viewport rather than stabilizing its eventual document position.

On a dedicated migrated local PostgreSQL fixture, a controlled table lock delayed season reads until Chromium had painted the actual layout fallback. Equivalent fresh events supplied 20 published announcements for the long page and an empty optional information page for the short page. At 1440×1000 the baseline footer source contributed 0.057 CLS; the candidate contributed zero (total observed 0.000127 from independent header/font sources). An independent cold 390×844 candidate run recorded zero layout shift. Both widths retained reachable footer links on both routes and had no document horizontal overflow. The initial desktop footer top changed from 942.5px to 1064px; the candidate's long-page footer later moved to 8960px in document flow. Its zero footer-source CLS therefore reflects remaining outside the initial viewport, not an unchanged document position or elimination of whole-page layout movement. The short document heights increased from 1000px to 1122px desktop and from 844px to 1008px mobile: approximately 122px/164px of additional short-page scrolling is the explicit layout tradeoff. The slot remains one small viewport; it must not be enlarged merely to suppress a score.

The exact geometry, source entries, layout source hash, fixture description and reproduction steps are in `2026-10-25-season-layout-slot.json`. Final integrated acceptance remains pending: W07 must measure total CLS and genuine primary-content ready on the same final candidate, then verify short-page footer reachability on desktop/mobile. These development runs isolate the footer source and do not establish the production CLS/LCP budget or primary-content latency. The same browser run exposed the season announcements entrypoint's URL-data instant-shell warning; its params/searchParams access now lives inside its own Suspense/io boundary, using the same standard PageLayout as its fallback. Subsequent real route navigations no longer logged that warning.
