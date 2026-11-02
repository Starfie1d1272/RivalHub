import "server-only";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { betMarkets, betPrograms, freePredictionLocks, matchActualStartAdoptions as adoptions, matchMaps, matches, matchVetoSessions } from "@/db/schema";
import { writeAuditInTx } from "@/lib/audit/write";
import { AppError, ErrorCode } from "@/lib/errors";
import { lockCompetitionMatchInTx } from "./locking";

function invalid(message: string): never { throw new AppError(ErrorCode.VALIDATION_FAILED, message); }

/** Pure decision layer; database comparisons retain full timestamp precision. */
export function planActualStart(input: { status: string; isForfeit: boolean; revision: number; expectedRevision: number; original: string | null; adopted: string | null }) {
  if (!["in_progress", "finished"].includes(input.status) || input.isForfeit) invalid("仅能为已开始的正常比赛记录实际开局时间。");
  if (input.revision !== input.expectedRevision) invalid("实际开局记录已更新，请刷新后重新核对。");
  return { revision: input.revision + 1, previousAt: input.adopted ?? input.original };
}

/** Raw text keeps PostgreSQL microseconds for the optimistic comparison. */
export async function readActualStartSnapshot(tx: Pick<TxDb, "select">, matchId: string) {
  const [row] = await tx.select({
    original: sql<string | null>`least(${matches.gameplayStartedAt}, (select min(mm.started_at) from match_maps mm where mm.match_id = ${matchId}))::text`,
    revision: sql<number>`coalesce((select max(a.revision) from match_actual_start_adoptions a where a.match_id = ${matchId}), 0)::int`,
    adopted: sql<string | null>`(select a.actual_at::text from match_actual_start_adoptions a where a.match_id = ${matchId} order by a.revision desc limit 1)`,
  }).from(matches).where(eq(matches.id, matchId));
  return row ?? null;
}

export async function adoptActualStartInTx(tx: TxDb, input: {
  seasonId: string; matchId: string; actorId: string; requestId: string;
  expectedRevision: number; expectedOriginal: string | null; actualAt: string; reason: string; evidence: string;
}) {
  const match = await lockCompetitionMatchInTx(tx, input.matchId);
  if (match.seasonId !== input.seasonId) throw new AppError(ErrorCode.FORBIDDEN, "比赛不属于当前赛事。");
  const [retry] = await tx.select().from(adoptions).where(and(eq(adoptions.matchId, match.id), eq(adoptions.requestId, input.requestId)));
  if (retry) {
    const [same] = await tx.select({ value: sql<boolean>`${retry.actualAt}::timestamptz = ${input.actualAt}::timestamptz and ${retry.originalFactAt}::timestamptz is not distinct from ${input.expectedOriginal}::timestamptz` }).from(matches).where(eq(matches.id, match.id));
    if (!same?.value || retry.revision !== input.expectedRevision + 1 || retry.actorId !== input.actorId || retry.reason !== input.reason || retry.evidence !== input.evidence) invalid("该请求编号已用于其他内容，请刷新后重试。");
    return;
  }
  const snapshot = await readActualStartSnapshot(tx, match.id);
  if (!snapshot) invalid("比赛不存在。");
  const plan = planActualStart({ ...snapshot, status: match.status, isForfeit: match.isForfeit, expectedRevision: input.expectedRevision });
  const [originalCheck] = await tx.select({ same: sql<boolean>`${snapshot.original}::timestamptz is not distinct from ${input.expectedOriginal}::timestamptz` }).from(matches).where(eq(matches.id, match.id));
  if (!originalCheck?.same) invalid("原始开局事实已变化，请刷新后重新核对。");
  const [veto] = await tx.select({ completedAt: matchVetoSessions.completedAt }).from(matchVetoSessions).where(eq(matchVetoSessions.matchId, match.id));
  const [bounds] = await tx.select({
    valid: sql<boolean>`${input.actualAt}::timestamptz <= clock_timestamp()
      and exists (select 1 from ${matchMaps} first_map where first_map.match_id = ${match.id} and first_map.map_order = 1)
      and exists (select 1 from match_veto_sessions v where v.match_id = ${match.id} and v.completed_at <= ${input.actualAt}::timestamptz)
      and (${matches.completedAt} is null or ${input.actualAt}::timestamptz <= ${matches.completedAt})
      and not exists (select 1 from ${matchMaps} mm where mm.match_id = ${match.id} and ((mm.map_order = 1 and mm.completed_at < ${input.actualAt}::timestamptz) or (mm.map_order > 1 and mm.started_at < ${input.actualAt}::timestamptz)))`,
  }).from(matches).where(eq(matches.id, match.id));
  if (!veto?.completedAt || !bounds?.valid) invalid("请核对 BP 已完成，且实际开局时间不晚于当前时间及已确认结束或后续地图开局。");
  // Lock the program after season and match, before touching financial admission.
  await tx.select({ seasonId: betPrograms.seasonId }).from(betPrograms).where(eq(betPrograms.seasonId, input.seasonId)).for("update");
  const [adoption] = await tx.insert(adoptions).values({ seasonId: input.seasonId, matchId: match.id, revision: plan.revision,
    requestId: input.requestId, originalFactAt: snapshot.original, previousAt: plan.previousAt,
    actualAt: input.actualAt, actorId: input.actorId, reason: input.reason, evidence: input.evidence }).returning();
  const impact = await readActualStartImpact(tx, match.id, input.actualAt);
  await writeAuditInTx(tx, { seasonId: input.seasonId, actorId: input.actorId, action: "match.actual_start.adopt", targetId: match.id,
    meta: { revision: adoption!.revision, previousAt: adoption!.previousAt, actualAt: adoption!.actualAt, recordedAt: adoption!.recordedAt, reason: input.reason, evidence: input.evidence, impact } });
  await tx.update(betMarkets).set({ lockedAt: sql`clock_timestamp()` }).where(and(eq(betMarkets.seasonId, input.seasonId), isNull(betMarkets.lockedAt), or(
    and(eq(betMarkets.matchId, match.id), sql`(${betMarkets.subject}->>'kind' = 'match' or ${betMarkets.type} like 'veto_%' or ((${betMarkets.subject}->>'kind' in ('map', 'map_slot')) and ${betMarkets.subject}->>'mapOrder' = '1'))`),
    match.majorStageRunId ? sql`${betMarkets.subject}->>'kind' = 'event'` : undefined,
  )));
  if (!match.testConfig) await tx.insert(freePredictionLocks).values({ matchId: match.id, seasonId: input.seasonId, resultLockedAt: sql`clock_timestamp()`, bpLockedAt: sql`clock_timestamp()` })
    .onConflictDoUpdate({ target: freePredictionLocks.matchId, set: { resultLockedAt: sql`coalesce(${freePredictionLocks.resultLockedAt}, clock_timestamp())`, bpLockedAt: sql`coalesce(${freePredictionLocks.bpLockedAt}, clock_timestamp())` } });
}

/** Counts are advisory and are read again at adoption time by the operator. */
export async function readActualStartImpact(tx: Pick<TxDb, "select">, matchId: string, at: string) {
  const [row] = await tx.select({
    stakes: sql<number>`(select count(*)::int from bet_stakes s join bet_markets b on b.id=s.market_id where (b.match_id=${matchId} or (b.season_id=(select season_id from matches where id=${matchId}) and b.subject->>'kind'='event' and exists (select 1 from matches where id=${matchId} and major_stage_run_id is not null))) and s.created_at >= ${at}::timestamptz)`,
    requests: sql<number>`(select count(*)::int from free_prediction_requests r join free_prediction_choices c on c.id=r.choice_id where c.match_id=${matchId} and r.created_at >= ${at}::timestamptz)`,
    settlements: sql<number>`(select count(*)::int from bet_settlements s join bet_markets b on b.id=s.market_id where (b.match_id=${matchId} or (b.season_id=(select season_id from matches where id=${matchId}) and b.subject->>'kind'='event' and exists (select 1 from matches where id=${matchId} and major_stage_run_id is not null))))`,
    appeals: sql<number>`(select count(*)::int from match_veto_appeals a join match_veto_timeout_incidents i on i.id=a.timeout_incident_id where i.match_id=${matchId} and a.created_at >= ${at}::timestamptz)`,
  }).from(matches).where(eq(matches.id, matchId));
  return row ?? { stakes: 0, requests: 0, settlements: 0, appeals: 0 };
}
