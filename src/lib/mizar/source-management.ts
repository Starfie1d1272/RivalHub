import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gt, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, type TxDb } from "@/db/client";
import { competitionEntries, matchLiveSessions, matches, mizarInstallations, mizarReliableReceipts, seasonAdminGrants, users } from "@/db/schema";
import { alias } from "drizzle-orm/pg-core";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { lockMatchInTx } from "@/lib/match-rosters/service";
import { validateSeriesScore } from "@/lib/matches/result-rules";
import { writeAuditInTx } from "@/lib/audit/write";
import { AppError, ErrorCode } from "@/lib/errors";

const identitySchema = z.strictObject({ installationId: z.uuid(), matchId: z.uuid(), producerInstanceId: z.string().min(1).max(128), liveSessionId: z.string().min(1).max(128), authorityRevision: z.number().int().positive() });
export const closeSourceSchema = z.strictObject({ sessionId: z.uuid(), identity: identitySchema, expectedVersion: z.string().regex(/^[a-f0-9]{64}$/), reason: z.string().trim().max(500) });
type Source = typeof matchLiveSessions.$inferSelect;
type Match = typeof matches.$inferSelect;
type ReceiptSummary = { count: number; latest: { id: string; acceptedAt: Date; kind: string; outcome: string } | null };
const quietMs = 15 * 60_000;

function version(source: Source, match: Match, receipts: ReceiptSummary) {
  // Hash the complete source and relevant canonical match/result facts, not an authorization token.
  return createHash("sha256").update(JSON.stringify({ source, match: { status: match.status, completedAt: match.completedAt, updatedAt: match.updatedAt, format: match.format, scoreA: match.scoreA, scoreB: match.scoreB, resultDisposition: match.resultDisposition }, receipts })).digest("hex");
}
function identity(source: Source) {
  return { installationId: source.installationId, matchId: source.matchId, producerInstanceId: source.producerInstanceId, liveSessionId: source.liveSessionId, authorityRevision: source.authorityRevision };
}
function eligible(source: Source, match: Match, receipts: ReceiptSummary, now: Date): string | null {
  if (match.status !== "finished" || !match.completedAt || match.completedAt > now || match.scoreA === null || match.scoreB === null || (match.resultDisposition && match.resultDisposition !== "recorded")) return "比赛终态或正式赛果尚未确定";
  try { validateSeriesScore(match.format, match.scoreA, match.scoreB); } catch { return "正式赛果无效"; }
  const lastActivity = Math.max(match.completedAt.getTime(), source.openedAt.getTime(), source.lastReliableEventAt?.getTime() ?? 0, receipts.latest?.acceptedAt.getTime() ?? 0);
  if (lastActivity > now.getTime() - quietMs) return "最近 15 分钟内有可靠上报或来源刚打开";
  return null;
}
async function receiptSummaries(executor: Pick<TxDb, "select" | "selectDistinctOn">, ids: string[]): Promise<Map<string, ReceiptSummary>> {
  if (!ids.length) return new Map();
  const totals = await executor.select({ sessionId: mizarReliableReceipts.sessionId, count: count() }).from(mizarReliableReceipts).where(inArray(mizarReliableReceipts.sessionId, ids)).groupBy(mizarReliableReceipts.sessionId);
  const latest = await executor.selectDistinctOn([mizarReliableReceipts.sessionId], { sessionId: mizarReliableReceipts.sessionId, id: mizarReliableReceipts.id, acceptedAt: mizarReliableReceipts.acceptedAt, kind: mizarReliableReceipts.kind, outcome: mizarReliableReceipts.outcome }).from(mizarReliableReceipts).where(inArray(mizarReliableReceipts.sessionId, ids)).orderBy(asc(mizarReliableReceipts.sessionId), desc(mizarReliableReceipts.acceptedAt), desc(mizarReliableReceipts.id));
  const result = new Map<string, ReceiptSummary>();
  for (const row of totals) result.set(row.sessionId, { count: row.count, latest: null });
  for (const { sessionId, ...row } of latest) result.get(sessionId)!.latest = row;
  return result;
}

export async function listSourceSessions(seasonId: string, cursor?: string) {
  const actor = await requireSeasonAdmin(seasonId);
  const entryA = alias(competitionEntries, "source_entry_a");
  const entryB = alias(competitionEntries, "source_entry_b");
  const rows = await db.select({ source: matchLiveSessions, match: matches, ownerId: mizarInstallations.authorizedByUserId, ownerName: users.displayName, entryA: entryA.name, entryB: entryB.name }).from(matchLiveSessions)
    .innerJoin(matches, eq(matches.id, matchLiveSessions.matchId)).innerJoin(mizarInstallations, eq(mizarInstallations.id, matchLiveSessions.installationId)).innerJoin(users, eq(users.id, mizarInstallations.authorizedByUserId))
    .leftJoin(entryA, eq(entryA.id, matches.entryAId)).leftJoin(entryB, eq(entryB.id, matches.entryBId))
    .where(and(eq(matches.seasonId, seasonId), eq(mizarInstallations.competitionId, seasonId), cursor ? gt(matchLiveSessions.id, cursor) : undefined)).orderBy(asc(matchLiveSessions.id)).limit(101);
  const page = rows.slice(0, 100);
  const summaries = await receiptSummaries(db, page.map(row => row.source.id));
  const now = new Date();
  return { rows: page.map(({ source, match, ownerId, ownerName, entryA, entryB }) => {
    const receipts = summaries.get(source.id) ?? { count: 0, latest: null };
    return { sessionId: source.id, identity: identity(source), expectedVersion: version(source, match, receipts), ownerName: ownerName?.trim() || "赛事管理员", owned: ownerId === actor.userId, canClose: ownerId === actor.userId || actor.role === "super_admin", entryA, entryB, matchStatus: match.status, completedAt: match.completedAt?.toISOString() ?? null, matchUpdatedAt: match.updatedAt.toISOString(), openedAt: source.openedAt.toISOString(), closedAt: source.closedAt?.toISOString() ?? null, closeReason: source.closeReason, contextRevision: source.contextRevision, generation: source.programSourceGeneration, epoch: source.mapEpoch, lastReliableSeq: source.lastReliableSeq, lastReliableEventAt: source.lastReliableEventAt?.toISOString() ?? null, health: { identity: source.identityHealth, lineup: source.lineupHealth, continuity: source.continuityHealth }, receiptCount: receipts.count, latestReceipt: receipts.latest && { acceptedAt: receipts.latest.acceptedAt.toISOString(), kind: receipts.latest.kind, outcome: receipts.latest.outcome }, blockedReason: source.closedAt ? null : eligible(source, match, receipts, now) };
  }), nextCursor: rows.length > 100 ? page.at(-1)!.source.id : null };
}

export async function closeCompletedSource(seasonId: string, actorId: string, input: z.infer<typeof closeSourceSchema>, requestId = randomUUID()) {
  return db.transaction(async tx => {
    const [installation] = await tx.select({ id: mizarInstallations.id, ownerId: mizarInstallations.authorizedByUserId }).from(mizarInstallations).where(and(eq(mizarInstallations.id, input.identity.installationId), eq(mizarInstallations.competitionId, seasonId))).for("update");
    if (!installation) throw new AppError(ErrorCode.FORBIDDEN, "设备不属于当前赛事。");
    const [actor] = await tx.select({ role: users.role }).from(users).where(eq(users.id, actorId)).for("share");
    const [grant] = actor?.role === "super_admin" ? [] : await tx.select({ userId: seasonAdminGrants.userId }).from(seasonAdminGrants).where(and(eq(seasonAdminGrants.userId, actorId), eq(seasonAdminGrants.seasonId, seasonId))).for("share");
    if (!actor || (actor.role !== "super_admin" && !grant)) throw new AppError(ErrorCode.FORBIDDEN, "当前账号没有该赛事的管理员权限。");
    if (installation.ownerId !== actorId) {
      if (actor?.role !== "super_admin") throw new AppError(ErrorCode.FORBIDDEN, "请由设备授权人或超级管理员关闭来源。");
      if (!input.reason) throw new AppError(ErrorCode.VALIDATION_FAILED, "请填写关闭他人设备来源的原因。");
    }
    const match = await lockMatchInTx(tx, input.identity.matchId);
    if (match.seasonId !== seasonId) throw new AppError(ErrorCode.FORBIDDEN, "比赛不属于当前赛事。");
    const [source] = await tx.select().from(matchLiveSessions).where(eq(matchLiveSessions.id, input.sessionId)).for("update");
    if (!source || JSON.stringify(identity(source)) !== JSON.stringify(input.identity)) return { status: "changed" as const };
    if (source.closedAt) return { status: "already_closed" as const };
    const receipts = (await receiptSummaries(tx, [source.id])).get(source.id) ?? { count: 0, latest: null };
    if (version(source, match, receipts) !== input.expectedVersion) return { status: "changed" as const };
    const now = new Date();
    const blockedReason = eligible(source, match, receipts, now);
    if (blockedReason) return { status: "blocked" as const, reason: blockedReason };
    await tx.update(matchLiveSessions).set({ closedAt: now, closeReason: "admin_completed_cleanup", autoCanonicalizationArmed: false }).where(eq(matchLiveSessions.id, source.id));
    await writeAuditInTx(tx, { seasonId, actorId, action: "mizar.source.admin_cleanup", targetId: match.id, meta: { sessionId: source.id, ...identity(source), expectedVersion: input.expectedVersion, matchStatus: match.status, completedAt: match.completedAt?.toISOString(), matchUpdatedAt: match.updatedAt.toISOString(), receiptCount: receipts.count, latestReceipt: receipts.latest, lastReliableEventAt: source.lastReliableEventAt?.toISOString() ?? null, previousClosedAt: null, closedAt: now.toISOString(), closeReason: "admin_completed_cleanup", reason: input.reason, requestId } });
    return { status: "closed" as const };
  });
}
