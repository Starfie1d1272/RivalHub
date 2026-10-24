# Play-in operator match record

`loadQualificationSwissMatchRecord(seasonId, matchId): Promise<{stageName: string; record: string} | null>` is exported by `src/lib/matches/qualification-stage-read-model.ts`. The authorized operator consumer can replace its full-stage lookup with this DTO. The reader is server-only, fresh and uncached; it does not authorize an entrypoint or mutate facts.

The reader selects the run's ID/format/direct-entry cut, frozen entrant IDs/seeds, and all linked matches' canonical pairing/result fields. Both the full stage model and the narrow DTO call the same extracted validation/projection boundary and record formatter in the existing qualification presentation owner. Validation still checks contiguous preliminary seeds, the direct-entry cut, frozen membership, BO1/Play-in/manual context, canonical complete pairings, round progression and result facts. A different match's invalid pairing rejects the requested record too. The returned record is the pre-round canonical group label (for example `1:0`), not this match's current score. Unknown/foreign targets, missing runs, non-Swiss formats or rejected facts return null.

No team name/logo join or BO1 map display-score read is needed. Existing full stage consumers retain both. The entry/season and run/season foreign keys keep the frozen membership scope without the presentation-only entry join. No alternate pairing algorithm, schema, permission, cache, clock or revision is introduced. Backend consumers remain separately owned.

Validation: 17 pure-domain cases cover current/completed rounds, record equivalence, the direct-entry cut, invalid membership/seed/pairing/context/results and unknown targets. Three real PostgreSQL cases protect equivalence, read footprint, map/name independence, foreign/missing targets, non-Swiss format and corruption outside the requested match.

A four-entry isolated fixture has two finished BO1 matches with completed maps and two scheduled round-two matches. Real SELECT footprint for full stage versus narrow record: 4→3 queries, 11→9 returned rows, 1435→955 JSON bytes. These are PG result JSON bytes, not transport billing, timing, concurrency or production performance evidence. The fixtures run only in the canonical isolated integration harness.

```bash
source /workspace/.onboarding/activate.sh
pnpm exec vitest run src/lib/competition-qualification/presentation.test.ts
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 pnpm test:integration tests/integration/db/qualification-match-record.test.ts
```

Integration order: merge the already reviewed public-entrypoint PR first, then this additive reader, then connect the backend owner's consumer. No changes belong in the frozen public-entrypoint PR.
