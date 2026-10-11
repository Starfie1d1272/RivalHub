import "server-only";
import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { matches, matchMaps, matchVetoAppeals, matchVetoTimeoutIncidents } from "@/db/schema";
import { writeAuditInTx } from "@/lib/audit/write";

export const VETO_APPEAL_CLOSURE_NOTE = "正式对局已开始，BP 恢复窗口已结束；原超时记录与申诉原因保留，超时责任未作裁定。如需进一步赛务处理，请联系赛事管理员并提供超时记录。";

/** Operational start and BP completion are not evidence of actual gameplay. */
export async function hasVetoGameplayInTx(tx: Pick<TxDb, "query" | "select">, matchId: string): Promise<boolean> {
  const match = await tx.query.matches.findFirst({ where: eq(matches.id, matchId), columns: { gameplayStartedAt: true } });
  if (match?.gameplayStartedAt) return true;
  const [map] = await tx.select({ id: matchMaps.id }).from(matchMaps).where(and(
    eq(matchMaps.matchId, matchId),
    or(isNotNull(matchMaps.startedAt), isNotNull(matchMaps.scoreA), isNotNull(matchMaps.scoreB), isNotNull(matchMaps.completedAt)),
  )).limit(1);
  return Boolean(map);
}

/** Caller holds the canonical match lock, shared with appeal submission and resolution. */
export async function closeVetoAppealsAfterGameplayInTx(tx: TxDb, matchId: string): Promise<boolean> {
  if (!await hasVetoGameplayInTx(tx, matchId)) return false;
  const pending = await tx.select({ id: matchVetoAppeals.id }).from(matchVetoAppeals)
    .innerJoin(matchVetoTimeoutIncidents, eq(matchVetoTimeoutIncidents.id, matchVetoAppeals.timeoutIncidentId))
    .where(and(eq(matchVetoTimeoutIncidents.matchId, matchId), eq(matchVetoAppeals.status, "pending")));
  if (!pending.length) return false;
  const match = await tx.query.matches.findFirst({ where: eq(matches.id, matchId), columns: { seasonId: true } });
  for (const appeal of pending) {
    await tx.update(matchVetoAppeals).set({ status: "closed", resolvedAt: sql`clock_timestamp()`, resolutionNote: VETO_APPEAL_CLOSURE_NOTE })
      .where(and(eq(matchVetoAppeals.id, appeal.id), eq(matchVetoAppeals.status, "pending")));
    await writeAuditInTx(tx, { seasonId: match?.seasonId ?? null, actorId: "system:veto-appeal-lifecycle", action: "match.veto.appeal_close", targetId: matchId, meta: { appealId: appeal.id, reason: "gameplay_started" } });
  }
  return true;
}
