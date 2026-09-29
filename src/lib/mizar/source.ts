import "server-only";
import { and, eq, isNull, desc } from "drizzle-orm";
import { z } from "zod";
import { db, type TxDb } from "@/db/client";
import { matchLiveSessions, mizarInstallations, users, type Match } from "@/db/schema";
import { lockMatchInTx, materializeDefaultLineupsInTx } from "@/lib/match-rosters/service";
import { loadEffectiveMatchRoster } from "@/lib/match-rosters/effective";
import { AppError, ErrorCode } from "@/lib/errors";
import { writeAuditInTx } from "@/lib/audit/write";
import { assertInstallationInTx } from "./installation";
import { loadMizarMatchDocumentInTx } from "./context";

export const sourceClaimSchema = z.strictObject({
  matchId: z.uuid(), producerInstanceId: z.string().min(1).max(128), liveSessionId: z.string().min(1).max(128),
  programSourceGeneration: z.number().int().nonnegative(), mapEpoch: z.number().int().nonnegative(),
  contextRevision: z.string().min(1).max(128), takeover: z.boolean().default(false),
  lineupSteam64: z.array(z.string().regex(/^\d{17}$/)).max(10).default([]),
});

export const sourceReleaseSchema = z.strictObject({
  matchId: z.uuid(),
  producerInstanceId: z.string().min(1).max(128),
  liveSessionId: z.string().min(1).max(128),
});

export async function validateObservedLineupInTx(tx: TxDb, match: Match, steam64s: readonly string[]) {
  const players = await loadEffectiveMatchRoster(tx, [match.id]);
  const expected = players.filter(player => player.isStarter).map(player => player.steam64);
  return expected.length === 10 && expected.every(id => id !== null) && new Set(steam64s).size === 10 && expected.every(id => steam64s.includes(id!));
}

export async function claimMizarSource(installationId: string, competitionId: string, input: z.infer<typeof sourceClaimSchema>) {
  return db.transaction(async tx => {
    await assertInstallationInTx(tx, installationId, competitionId);
    const match = await lockMatchInTx(tx, input.matchId);
    if (match.seasonId !== competitionId || !["scheduled", "in_progress"].includes(match.status)) throw new AppError(ErrorCode.FORBIDDEN, "不能连接这场比赛的数据源。");
    await materializeDefaultLineupsInTx(tx, match);
    const context = await loadMizarMatchDocumentInTx(tx, match.id, competitionId);
    if (input.contextRevision !== context.revision) throw new AppError(ErrorCode.VALIDATION_FAILED, "比赛资料已变化，请刷新后重试。");
    const lineupValid = input.lineupSteam64.length === 10 && await validateObservedLineupInTx(tx, match, input.lineupSteam64);
    if (input.lineupSteam64.length > 0 && !lineupValid) throw new AppError(ErrorCode.VALIDATION_FAILED, "实际首发不匹配，请核对后重试。");
    const [active] = await tx.select().from(matchLiveSessions).where(and(eq(matchLiveSessions.matchId, match.id), isNull(matchLiveSessions.closedAt))).for("update");
    if (active?.installationId === installationId && active.producerInstanceId === input.producerInstanceId && active.liveSessionId === input.liveSessionId) {
      if (active.contextRevision !== input.contextRevision) await tx.update(matchLiveSessions).set({ contextRevision: input.contextRevision, autoCanonicalizationArmed: false, continuityHealth: "unknown" }).where(eq(matchLiveSessions.id, active.id));
      return { authorityRevision: active.authorityRevision, claimed: true };
    }
    if (active && !input.takeover) {
      const [device] = await tx.select({ displayName: users.displayName }).from(mizarInstallations).innerJoin(users, eq(users.id, mizarInstallations.authorizedByUserId)).where(eq(mizarInstallations.id, active.installationId));
      return { claimed: false, activeDeviceName: device?.displayName?.trim() || "另一位赛事管理员", authorityRevision: active.authorityRevision };
    }
    const [latest] = await tx.select({ revision: matchLiveSessions.authorityRevision }).from(matchLiveSessions).where(eq(matchLiveSessions.matchId, match.id)).orderBy(desc(matchLiveSessions.authorityRevision)).limit(1);
    const now = new Date();
    if (active) await tx.update(matchLiveSessions).set({ closedAt: now, closeReason: "handover", autoCanonicalizationArmed: false }).where(eq(matchLiveSessions.id, active.id));
    const [binding] = await tx.insert(matchLiveSessions).values({ matchId: match.id, installationId, producerInstanceId: input.producerInstanceId, liveSessionId: input.liveSessionId, authorityRevision: (latest?.revision ?? 0) + 1, programSourceGeneration: input.programSourceGeneration, mapEpoch: input.mapEpoch, contextRevision: input.contextRevision, identityHealth: "unknown", lineupHealth: lineupValid ? "healthy" : "unknown", continuityHealth: "unknown", autoCanonicalizationArmed: false }).returning();
    await tx.update(mizarInstallations).set({ lastSeenAt: now }).where(eq(mizarInstallations.id, installationId));
    await writeAuditInTx(tx, { seasonId: competitionId, actorId: installationId, action: "mizar.source.claim", targetId: match.id, meta: { installationId, authorityRevision: binding.authorityRevision, previousInstallationId: active?.installationId ?? null } });
    return { claimed: true, authorityRevision: binding.authorityRevision };
  });
}

export async function releaseMizarSource(
  installationId: string,
  competitionId: string,
  input: z.infer<typeof sourceReleaseSchema>,
  authorityRevision: number,
) {
  await db.transaction(async tx => {
    await assertInstallationInTx(tx, installationId, competitionId);
    const match = await lockMatchInTx(tx, input.matchId);
    if (match.seasonId !== competitionId) throw new AppError(ErrorCode.FORBIDDEN, "不能访问这场比赛。");
    const [source] = await tx.select().from(matchLiveSessions).where(and(
      eq(matchLiveSessions.matchId, input.matchId),
      eq(matchLiveSessions.installationId, installationId),
      eq(matchLiveSessions.authorityRevision, authorityRevision),
      eq(matchLiveSessions.producerInstanceId, input.producerInstanceId),
      eq(matchLiveSessions.liveSessionId, input.liveSessionId),
    )).for("update");
    if (!source) throw new AppError(ErrorCode.FORBIDDEN, "数据源权限已变化，请刷新后重试。");
    if (source.closedAt) {
      // A lost response may retry the exact release, but a source closed by
      // handover/revoke must never release a newer authority.
      if (source.closeReason === "released") return;
      throw new AppError(ErrorCode.FORBIDDEN, "数据源权限已变化，请刷新后重试。");
    }
    await tx.update(matchLiveSessions).set({ closedAt: new Date(), closeReason: "released", autoCanonicalizationArmed: false }).where(eq(matchLiveSessions.id, source.id));
    await writeAuditInTx(tx, {
      seasonId: competitionId,
      actorId: installationId,
      action: "mizar.source.release",
      targetId: input.matchId,
      meta: { authorityRevision, producerInstanceId: input.producerInstanceId, liveSessionId: input.liveSessionId },
    });
  });
}

export async function takeOverCurrentMap(matchId: string, actorId: string) {
  await db.transaction(async tx => {
    const match = await lockMatchInTx(tx, matchId);
    const [source] = await tx.select().from(matchLiveSessions).where(and(eq(matchLiveSessions.matchId, matchId), isNull(matchLiveSessions.closedAt))).for("update");
    if (!source || match.status !== "in_progress") throw new AppError(ErrorCode.VALIDATION_FAILED, "当前没有需要接管的正式对局。");
    await tx.update(matchLiveSessions).set({ autoCanonicalizationArmed: false, manualTakeoverMapEpoch: source.mapEpoch }).where(eq(matchLiveSessions.id, source.id));
    await writeAuditInTx(tx, { seasonId: match.seasonId, actorId, action: "mizar.map.manual_takeover", targetId: matchId, meta: { sessionId: source.id, mapEpoch: source.mapEpoch } });
  });
}
