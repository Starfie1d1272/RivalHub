# Community award administrator read boundaries

`src/lib/community-awards/data.ts` owns the additive readers:

- `getAdminCommunityAwardBoardSummaries(executor, {seasonId})` returns `{awards: CommunityAwardAdminSummary[], stages}`. The summary retains ID/name/prize/status, recipient and settlement policies, resultVersion, submitter/recipient identities, settlementReady/nonAwardingReady, evidenceCount and eligibleEvidenceCount. It omits condition, supplementary/public/review/outcome notes, evidence bodies and form options.
- `getAdminCommunityAwardDetail(executor, {seasonId, awardId, stagePlan})` returns `CommunityAwardModel | null`. Both award and evidence queries constrain season+award. Complete evidence/verification fields remain available; only evidence-referenced official same-season matches are loaded for labels. Missing/foreign awards return null; an empty/missing runtime ID returns null without SQL. A detail scope never falls back to the full board.
- Existing `getCommunityAwardFormOptions(executor, seasonId, stagePlan)` already supplies canonical candidates and match choices; consumers should call it only when a form needs them. No duplicate candidate API is introduced.

These are internal server readers. Page/action entrypoints must freshly authorize the requested season (including subsequent detail/form reads) before calling them. Backend pages, transport and UI consumers are owned separately and are unchanged in this provider PR. The old full-board API stays compatible until its consumer migrates; therefore adding these providers alone does not reduce the currently deployed administrator first-load work.

Summary evidence is aggregated per award into counts and eligible candidate IDs. The same `canSettleCommunityAward` policy evaluates those IDs against the unchanged whole-season `getCommunityAwardProgress`. Frozen Major snapshots/finalized rounds, Play-in completion and final confirmation retain their existing authority. No readiness derives from a currently displayed match subset. Result versions and mutation guards, clocks, withdrawals/corrections, recipients and public identity rules are unchanged. Recipient/submitter/evidence identity IDs share the existing batched reader. Evidence now has deterministic createdAt/id order in both full and detail reads, avoiding query-plan-dependent order changes when narrowing the scope.

Three focused real PostgreSQL cases protect full-reader equivalence, scope/null behavior, omitted summary fields, identity/label preservation, separate form choices, global custom-season readiness and frozen Major/Play-in progress. The existing comprehensive outcomes case also passes, including correction/concurrency/audit/privacy invariants. None of these substitutes for a new consumer's authorization/UI tests.

One isolated fixture contains four awards, twenty evidence bodies on one award, ten eligible form users and thirteen official match options. Real SELECT footprint for the legacy full board versus summary: **11→8 queries, 59→7 rows, 74397→866 result JSON bytes**. No production latency, LCP, concurrency or billing claim is made. Fixture names/bodies are synthetic; no raw private evidence or credentials are committed.

```bash
source /workspace/.onboarding/activate.sh
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 pnpm test:integration tests/integration/db/community-awards-admin-reads.test.ts tests/integration/db/community-awards-outcomes.test.ts
```

A-AWARDADMIN state: domain providers implemented/tested; backend summary/detail/form consumer migration remains required before closing the first-load optimization.
