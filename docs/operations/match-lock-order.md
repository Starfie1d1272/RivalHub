# Event and match writer lock protocol

Event writers acquire the existing season UPDATE fence before any official
match or child row, and retain it to commit. This intentionally preserves event
serialization; no throughput improvement from weaker season locks is claimed.
An unlocked scope discovery is followed by season lock, match lock and a scope
recheck. Scope changes fail closed instead of continuing under the wrong event.

| Writer family | First locks and retained closure |
| --- | --- |
| BP/start/map/result/scheduling | season UPDATE → match UPDATE → session/lineup/map children → trigger-owned prediction outboxes |
| Result correction | same fence; public plan/adjudication preserve archived inspection; applying correction rejects archived; downstream deletes stay in same event transaction |
| BET stake | user SHARE → season UPDATE → complete official parent set sorted by ID → all parent maps sorted ID → all veto sessions sorted ID → program UPDATE → fresh market/facts/receipt |
| Free prediction | active verified user SHARE → season UPDATE → match UPDATE → private choice/receipt; no BET program lock |
| Major/qualification/bracket | existing season UPDATE before run, match and dependent facts; never upgrade an earlier weaker season lock |
| Postevent final result / honors / adjudications | season UPDATE before final-result, honor or adjudication rows; revocation discovers and rechecks scope; archive uses the same order and explicit postevent channels remain allowed |
| Postmatch | season UPDATE → match UPDATE → report/commentator; explicitly permitted archive channels remain accessible |
| MVP settlement | season UPDATE SKIP LOCKED → match UPDATE SKIP LOCKED → votes read and winner/audit write; preserves nonblocking admission |
| Time auto-award/default lineup | season UPDATE → match UPDATE → proposal/coverage/lineups; ordinary archive guard applies |
| Demo submit/review/recheck/projection repair | existing identity gate → lineage advisory → season UPDATE before any import or match row. Existing import/match suborder is safe only while this exclusive event fence is retained. Empty-lineage advisory and unavailable-target classification remain canonical. |
| Mizar revoke | installation UPDATE → season UPDATE → complete active source scope UPDATE → audit; installation fence excludes ingress/LIVE, season fence excludes manual source writers |
| Mizar reliable/source | installation SHARE → canonical season/match boundary → live source; display heartbeat is separately committed by the W02 implementation, never upgraded under authority SHARE |
| LIVE broadcast | installation SHARE → match/source SHARE and broadcast inside authority; no event write or lock weakening |
| Roster confirmation (consumer prerequisite) | discover roster parent → season/match → roster UPDATE and recheck association; old child-first entry is incompatible |
| OCR save/clear (consumer prerequisite) | `lockMatchForEvidenceInTx`: season UPDATE → match SHARE → map UPDATE/stat rows, preserving post-event evidence policy; no KEY SHARE substitution |

`lockMatchInTx` enforces mutation archive policy. `lockMatchForInspectionInTx`
retains UPDATE but permits explicit archived inspection/adjudication.
`lockMatchForEvidenceInTx` permits existing evidence channels and retains SHARE
on the match. These are lock primitives, never authorization substitutes.

Trigger closure must include all parents selected for an event market, their
complete maps and veto sessions in the same transaction before a BET program
lock. It must not be reduced to current page/stage or loaded maps. Workers
holding a financial program may read official facts but must not acquire later
official row locks. Program locks, DB clock boundaries, settlement/frozen facts,
BigInt pool conservation and correction/withdrawal hard expiry remain intact.

## Coordinated switch

The canonical release owner remains [release.md](./release.md). This protocol
adds a coordinated quiescence prerequisite for the first lock-order switch and
its rollback; it does not authorize this implementation agent to stop services,
change production settings or deploy. The release coordinator executes it in
the existing approved maintenance window. Match-first old workers and
season-first new writers are incompatible: isolated match and postevent audit
barriers both reproduce `40P01`. No blind replay fixes that compatibility gap.

1. Freeze the canonical previous Production identity using the release owner,
   record the exact integrated candidate and eligible rollback source, and
   finish required CI, migration replay/N/N+1 and isolated consumer barriers.
   Include roster, OCR evidence, BET/free, BP, Mizar, Demo and postevent consumers;
   a helper-only deployment is incomplete. Build candidate artifacts before
   the outage. Do not run staging/fixture mutations against Production.
2. Stop admission to **all** old application writers, including authenticated
   actions, Mizar callbacks, cron/watchdog HTTP endpoints and independent
   production CLI/backfill invocations. On the current single-instance Linux
   hosting, the existing `rivalhub-production` service stop is the available
   complete application-admission boundary. It also interrupts public reads;
   this is a bounded maintenance outage, not a zero-downtime switch. Do not add
   another service, token, permanent ingress policy or cron to implement it.
   The pg_cron/pg_net and Actions watchdog can continue sending requests while
   the service is stopped; unsuccessful dispatch is not business execution.
   Do not report these expected maintenance failures as successful delivery.
3. Verify the old service is actually stopped and its process/callback workers
   exited. Its existing SIGTERM/30-second systemd stop timeout is not evidence
   that every transaction committed. After stopping independent writers, use
   the approved read-only database channel to observe transaction counts until
   there are no transactions for the application role/database and no prepared
   transactions. Observe twice, with no writer admitted between observations.
   Bound this drain observation to 60 seconds; a timeout, hidden activity due
   to insufficient visibility or ambiguous service state prevents candidate
   start. Retain the outage and investigate through the existing owner. Do not
   automatically terminate backends, revoke credentials or cancel transactions.
   A shared role may include other maintenance work: coordinate that work
   instead of excluding unexplained transactions from the count.
4. Run the remaining protected migration/verify and package installation steps
   through the release owner, with admission still closed to old writers.
   Recheck quiescence after any intentional migration/verification transaction
   finishes and before starting the candidate. No old application or old
   independent worker may restart during this interval. Supabase dispatch is
   an HTTP wake-up; queued requests after candidate start execute only the
   candidate's implementation. Never run both source identities together.
5. Start the exact candidate using the existing installation transaction;
   verify canonical release identity and the release owner's smoke. Resume
   independent workers only at that same source identity. Verify scheduler
   primary and endpoint health, durable BP pending-delivery recovery, Mizar
   authority/heartbeat and normal read paths. Receipt recovery determines
   uncertain command outcomes; a disconnected request is not proof of rollback
   and must not be replayed merely because the service restarted. Perform all
   concurrency/fault writes in isolated fixtures; Production checks remain
   low-frequency read-only verification.

Read-only drain evidence can be restricted to aggregate counts, without SQL
text, actor identities or payloads. In the protected application-role session,
exclude only the observer's own backend; include idle-in-transaction sessions:

```sql
SELECT count(*) AS open_transactions
FROM pg_stat_activity
WHERE datname = current_database() AND usename = current_user
  AND pid <> pg_backend_pid() AND xact_start IS NOT NULL;
SELECT count(*) AS prepared_transactions
FROM pg_prepared_xacts WHERE database = current_database();
```

These queries are evidence only if the observer can see every relevant writer
and all application writer roles/databases have been enumerated. The repository
currently has no release-integrated writer-admission/drain gate. The ordinary
`systemctl restart` installation path alone therefore does **not** establish
this first-switch prerequisite; the coordinator must complete the explicit
stop/drain window or supply an independently reviewed equivalent before release.

### Rollback and uncertain outcome

Rollback follows the same admission stop, old-process exit and bounded database
drain before starting the chosen previous source. Use the frozen previous
identity and existing capability checks/installation rollback; do not infer the
rollback target from the largest tag. If identity or install outcome is unknown,
read back canonical identity and host state first, then reconcile through the
release owner. Do not issue another install or rollback blindly.

Keep the additive 0096/0097/0098 migration chain and durable acknowledgements;
normal rollback does not reverse DDL, erase generations, reset published
watermarks, or delete OCR receipts. The old BP worker does not consume the new
delivery watermark. If the chosen old source lacks that worker, its scheduler
success cannot prove pending delivery completed. Pending obligations remain
unconfirmed and must be recovered by a compatible forward source; any required
public-cache hard expiry remains a release acceptance gap until its canonical
owner confirms it. Do not keep a new season-first worker beside an old
match-first application as a workaround. If an eligible consistent rollback
source or cache-consistency recovery is unavailable, retain the stopped state
and report that exact blocker instead of claiming a safe rollback.

## Isolated evidence and remaining closure

The match barrier holds a season in one connection, observes the new helper
waiting via `pg_blocking_pids`, then takes its match SHARE. A companion barrier
archives the season while the writer waits and proves mutation denial while
explicit inspection remains possible. Different matches within one event still
serialize at the existing UPDATE fence by design. A separate legacy barrier
reproduces exactly one `40P01`, without replaying either command.

The postevent barrier additionally includes the **real audit season foreign-key
edge**: old confirmation holds the final-result row while its audit insert waits
for season; archive's next final-result acquisition closes the old cycle. New
confirmation waits on season first, commits its confirmation and audit, and the
actual archive transition then succeeds. Existing P1–P20 postevent invariants
verify the result, adjudication, honor, audit and archive policies remain intact.

Consumer prerequisites above remain release requirements. Before final review,
read active trigger definitions and all candidate writers against the exact
integrated source, and run roster/OCR/Demo/financial races. This document and
local barrier success do not claim the Production drain or rollout occurred.

MVP cast currently inserts only votes under the existing match SHARE and has no
audit/season foreign-key edge. It is not classified as a demonstrated reverse
season-lock defect and does not require the OCR evidence helper. MVP settlement
is separate: it updates the winner and inserts an audit and therefore retains
its documented season-first worker boundary.

The Mizar revocation barrier holds the manual writer's actual season/match
locks and contends on source rows. The old revoker's real audit FK closes a
40P01 cycle; the new revoker waits at season before touching any source. The
fixture includes two active sources for the revoked installation and another
installation's source: the former both close, the latter remains open.
