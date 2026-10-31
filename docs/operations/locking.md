# Tournament mutation lock boundaries

Row locks, implicit DML/FK locks and active database triggers form one protocol.
The tables below describe the current owners; they are not a claim that every
writer already follows one global order. `UPDATE` and `SHARE` denote row modes.
Public reads do not acquire these mutation locks.

| Owner / entry | Locks and indirect writes |
| --- | --- |
| `matches/locking.ts`; roster, BP, scheduling, canonical result consumers | match UPDATE → season UPDATE → domain rows; official DML can acquire BET program and prediction job locks |
| `match-rosters/service.ts` confirmation | roster UPDATE precedes the canonical match/season helper; this inherited child→parent edge also needs coordinated migration |
| `postevent/guard.ts` | season UPDATE; callers which later change season state already require this exclusive mode |
| `actions/seasons.ts`, Major prestart/start/transition/playoff/swiss, `postevent/service.ts` archive | season UPDATE → run/entrant/roster/match/domain writes; these callers cannot be changed to a shared lifecycle gate |
| `match-corrections/service.ts`, match score corrections | source/downstream match locks and lifecycle guard; changing only the canonical match helper does not migrate these direct writers |
| `actions/matches/results.ts` scheduling/result metadata | lifecycle guard plus direct official DML; inherited locks must be checked at each entry |
| `free-predictions/service.ts` | match UPDATE → season UPDATE → user SHARE → permanent free fence/current choice/immutable receipt |
| `bet/service.ts` participant mutations | user SHARE → season UPDATE → relevant matches SHARE → maps/sessions SHARE → BET program UPDATE → account/market/stake/ledger |
| `predictions/service.ts` participant mutations | user SHARE → season UPDATE → stage matches SHARE → job UPDATE → prediction program UPDATE → window/account/pick/ledger |
| BET worker | program UPDATE → ordinary official reads → markets/settlements/ledger; it must not acquire official row locks afterward |
| Prediction worker | job UPDATE → program UPDATE → ordinary official reads → windows/judgements/ledger; it must not acquire match/season locks afterward |
| Mizar claim/reliable/release | installation SHARE → canonical match/season → source UPDATE; reliable receipt, canonical facts and audit commit together |
| Mizar revoke | installation UPDATE → active sources UPDATE; SHARE verification remains necessary to linearize revocation |
| Mizar LIVE | installation SHARE → match SHARE → source SHARE, with publication inside the transaction; channel disposal follows commit |
| Mizar display heartbeat | separate transaction after committed claim/reliable; installation only, skips busy/no-idle application pools, 25ms lock / 250ms statement budget, 30s DB write throttle, database clock, no revoked/cross-competition writes |
| `identity/write-lock.ts`, merge and confirmed Demo attribution | gameplay identity advisory gate first → user/identity or Demo lineage/season/domain rows; merge also reparents references and encounters their FK/trigger edges |
| Demo import/review/promotion and player statistics | identity gate where attribution changes → map lineage/official writes → prediction/BET outboxes; follow their existing identity owner |
| `postmatch/service.ts` | direct match UPDATE → submission/commentator/source rows; it uses a separate match owner, not the canonical helper |
| team/competition-entry/qualification/registration owners | aggregate parent/current revision/participant/active-claim/event-roster writes; FK and deferred aggregate validators remain part of their commit boundary |
| community awards | award parent and recipient writes; the recipient trigger locks old/new award parents, including reassignment |
| scheduler runners | invoke the same domain owners; job dispatch does not replace domain locks or allow an alternate writer order |

## Active trigger edges

| Function family | Additional boundary |
| --- | --- |
| `rivalhub_bet_official_outbox` | official row → BET program UPDATE → permanent market fences / dirty / stage milestone; bindings cover matches, maps, veto sessions/appeals/timeouts, runs/prestart/entrants/seeds/finals, Demo imports/stats and event rosters/members |
| `capture_free_prediction_start` | map/session AFTER trigger → parent match UPDATE → free prediction fence; a direct child writer must account for this reverse edge |
| `rivalhub_enqueue_predictions` | official row → job upsert/write → contest/legacy market fences and deadlines / stage milestone; it reads program rules without a program row lock |
| `community_award_recipients_lock` | recipient → old/new award parent UPDATE |
| `enforce_post_match_scope` | validates match, user/grant, submission and commentator scope; application parent serialization remains necessary |
| competition-entry aggregate/current-state/approved-source and event-roster validators | deferred current/approved revision, membership, active-claim and frozen-roster constraints; ordinary reads are not equivalent to a lifecycle lock |
| team current-state/history validators | deferred captain/name/membership consistency and append-only historical facts |
| frozen market/config, append-only ledger/receipt, permanent gameplay-start and test-identity validators | reject forbidden rewrites; these do not authorize removing the caller's serialization |
| community-award legacy guards/sync and final-result validators | frozen recipient/result scope plus recipient/audit DML; legacy compatibility remains active |
| deleted-season recruitment cleanup | closes recruitment intents when their target season is deleted; the FK deletion transaction owns its implicit locks |

An already permanent BET market is excluded from later outbox UPDATEs by
`locked_at IS NULL`. The same transaction still locks the program and publishes
dirty; intermediate BP steps can affect legacy markets. This does not weaken
financial admission or remove an outbox notification.

## Coordinated order changes

The current match→season and season→match paths can form a cycle. A migration
must change all participating application entries, direct child writers and
workers together. First retain UPDATE strength while moving discovery before
season→match acquisition, then revalidate match association under locks.
Discovery is neither authorization nor admission. Account/identity/installation
dependencies must also be included; an alphabetical table order is insufficient.

BP samples its database received-at before its first contended lock. BET relief
samples the database Beijing day after financial serialization. Neither clock
boundary may move as a side effect of reordering locks.

Only after real PostgreSQL barriers cover all participating writers may a
read-only lifecycle gate be evaluated for SHARE. Season writers must acquire
UPDATE at entry and never upgrade a shared lifecycle lock. KEY SHARE does not
block ordinary status/revoked-at changes and is unsuitable here. Program locks,
permanent fences, immutable receipts and authority-locked LIVE sending remain.

Old match-first and new season-first application processes cannot be assumed
safe to mix. The release owner must drain old HTTP/scheduler/worker writers
before switching order and must use the same coordinated boundary on rollback.
No production lock timeout increase, blind retry, manual schema patch or
disabled financial trigger substitutes for that rollout proof.

## BP postcommit delivery

`match_veto_invalidations` is a BP-owned, server-only delivery watermark. Its
match key, generation, published generation, transaction-coalescing ID and
bounded fact categories contain no actor, reason, credential or business
payload. Rows follow match retention and cascade on actual match deletion;
normal database backups include them. A restore must follow the existing
public-cache reset/hard-expire procedure before traffic resumes: a historical
published watermark is not proof that a surviving external cache matches the
restored database. Browser Data API and Realtime have no grants or policies.

Triggers register session/step/timeout/appeal/lineup/map changes in the same
transaction as those facts. Generation advances once per match/transaction;
additional categories in that transaction are merged. Unpublished categories
are retained until delivery. In particular, map creation, replacement and
rewind deletion register `map_plan`, which always retains broad statistics
invalidation because map catalog/options also consume unfinished match maps.

The postcommit owner reads current server season/status and persisted facts,
then invokes the canonical revalidation owner. It acknowledges only the
captured generation with CAS after all invalidations return successfully. A
new concurrent generation, cache exception or acknowledgement failure remains
pending. No user command is replayed. The HTTP response distinguishes cache
`invalidation: pending` from room `projection: pending`; a safe reconcile can
recover delivery even when its domain outcome is idempotent.

Ordinary GET remains read-only and exposes only a pending boolean, allowing a
visible client to retry reconcile with its existing in-flight/backoff gate.
The existing veto scheduler also drains at most fifty pending deliveries per
invocation, independently of paused/completed/archived lifecycle transitions.
After each selected delivery attempt, a still-pending captured generation moves
behind older pending work using its `updated_at` ordering timestamp. A successful
acknowledgement or a concurrent newer generation is not moved by that attempt;
`updated_at` therefore reflects either fact registration or a pending retry.
Delivery exceptions remain durable and cause scheduler execution to fail;
they are not reported as a successful cache publication. Old applications can
ignore the additive table; old workers do not acknowledge it. Rollback keeps
the obligation for a compatible forward worker rather than deleting facts.

Canonical BP invalidation categories are defined in `src/types/veto-room.ts`:
`lineups`, `appeals`, `veto_step`, `map_plan`, and legacy `veto`. Session,
step and timeout triggers register `veto_step`; every map write independently
unions `map_plan` in that same generation. Legacy backfill retains broad `veto`.
Old/unknown categories and map plans always invalidate broadly. New known
non-map steps may use the narrow scheduled/in-progress W09 contract; a mixed
pending generation retains every unpublished broad category until CAS delivery.
