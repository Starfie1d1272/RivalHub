import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { TxDb } from "@/db/client";
import { auditLogs, matchLiveSessions, matchMaps, matchDemoImports, matchPlayerStats, postMatchReports } from "@/db/schema";
import { loadEffectiveMatchRoster } from "@/lib/match-rosters/effective";
import { lockMatchInTx } from "@/lib/match-rosters/service";
import { assertSeasonAllowsTournamentMutationInTx } from "@/lib/postevent/guard";
import { planSeriesCompletionProgressionInTx } from "@/lib/match-corrections/series-completion";
import { sha256Json } from "@/lib/demo-integration/revision";
import { writeAuditInTx } from "@/lib/audit/write";
import { AppError, ErrorCode } from "@/lib/errors";
import { finishCanonicalSeriesInTx } from "./results";
import { planEarlySeriesFinish } from "./series-correction-rules";

export const seriesCorrectionRequestSchema = z.strictObject({
  matchId: z.uuid(), mapId: z.uuid(), scoreA: z.number().int().nonnegative(), scoreB: z.number().int().nonnegative(),
  expectedScoreA: z.number().int().nonnegative(), expectedScoreB: z.number().int().nonnegative(),
});
export const seriesCorrectionConfirmationSchema = seriesCorrectionRequestSchema.extend({
  previewRevision: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().trim().min(1, "请填写更正原因。").max(500),
  confirmed: z.literal(true), laterMapsNotStarted: z.literal(true),
});
export type SeriesCorrectionRequest = z.infer<typeof seriesCorrectionRequestSchema>;
export interface SeriesCorrectionPreview {
  revision: string; currentA: number; currentB: number; scoreA: number; scoreB: number;
  correctedMapOrder: number; oldA: number; oldB: number; newA: number; newB: number;
  maps: { order: number; label: string }[];
  downstreamCount: number; postTasksExist: boolean; progressionLabel: string; blockers: string[];
}

/** Match → season → source/downstream locks, shared with reliable/manual owners. */
export async function planSeriesAfterMapScoreChangeInTx(tx: TxDb, raw: SeriesCorrectionRequest): Promise<SeriesCorrectionPreview | null> {
  const input = seriesCorrectionRequestSchema.parse(raw);
  const match = await lockMatchInTx(tx, input.matchId);
  await assertSeasonAllowsTournamentMutationInTx(tx, match.seasonId);
  if (match.status !== "in_progress" || match.isForfeit) throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "请在进行中的正常比赛中核对系列更正。");
  const sessions = await tx.select().from(matchLiveSessions).where(eq(matchLiveSessions.matchId, match.id)).orderBy(asc(matchLiveSessions.id)).for("update");
  const maps = await tx.select().from(matchMaps).where(eq(matchMaps.matchId, match.id)).orderBy(asc(matchMaps.mapOrder)).for("update");
  const map = maps.find(row => row.id === input.mapId);
  if (!map || map.scoreA !== input.expectedScoreA || map.scoreB !== input.expectedScoreB) throw new AppError(ErrorCode.VALIDATION_FAILED, "正式比分已更新，请重新核对后提交。");
  const result = planEarlySeriesFinish(match.format, maps, input);
  if (!result) return null;
  const progression = await planSeriesCompletionProgressionInTx(tx, match);
  const history = await tx.select({ id: auditLogs.id, action: auditLogs.action, meta: auditLogs.meta }).from(auditLogs).where(and(eq(auditLogs.targetId, match.id), inArray(auditLogs.action, ["mizar.reliable.accept", "mizar.map.manual_takeover", "mizar.map.revalidated"]))).orderBy(asc(auditLogs.id));
  const imports = await tx.select({ id: matchDemoImports.id, matchMapId: matchDemoImports.matchMapId, status: matchDemoImports.status, evidenceRevision: matchDemoImports.evidenceRevision }).from(matchDemoImports).where(eq(matchDemoImports.matchId, match.id)).orderBy(asc(matchDemoImports.id));
  const stats = maps.length ? await tx.select().from(matchPlayerStats).where(inArray(matchPlayerStats.mapId, maps.map(row => row.id))).orderBy(asc(matchPlayerStats.id)) : [];
  const roster = await loadEffectiveMatchRoster(tx, [match.id]);
  const reports = await tx.select().from(postMatchReports).where(eq(postMatchReports.matchId, match.id)).orderBy(asc(postMatchReports.matchId));
  const blockers = [...result.blockers, ...progression.blockers];
  if (match.startedAt && result.completedAt < match.startedAt) blockers.push("地图完成时间早于比赛开始，请先核对实际比赛时间。");
  const startedIds = new Set<string>();
  for (const session of sessions) if (session.currentMapId && session.mapExecutionPhase === "gameplay") startedIds.add(session.currentMapId);
  for (const row of history) {
    const meta = row.meta as Record<string, unknown> | null;
    if (!meta) continue;
    // Durable observations remain relevant across generation resets/handover.
    if (row.action === "mizar.reliable.accept" && !["map_started", "map_ended"].includes(String(meta.kind))) continue;
    for (const map of maps) if (meta.mapId === map.id || meta.receivedMapId === map.id || meta.receivedMapName === map.mapName) startedIds.add(map.id);
  }
  for (const row of maps.filter(row => row.mapOrder > result.clinchingOrder && !row.completedAt)) {
    if (startedIds.has(row.id)) blockers.push(`Map ${row.mapOrder} 已开始，请先处理实际比赛事实。`);
    if (imports.some(item => item.matchMapId === row.id) || stats.some(item => item.mapId === row.id)) blockers.push(`Map ${row.mapOrder} 已有比赛数据，请先处理实际比赛事实。`);
  }
  return {
    revision: sha256Json({ input, match, maps, sessions, history, imports, stats, roster, reports, progression }),
    currentA: result.currentA, currentB: result.currentB, scoreA: result.scoreA, scoreB: result.scoreB,
    correctedMapOrder: map.mapOrder, oldA: map.scoreA!, oldB: map.scoreB!, newA: input.scoreA, newB: input.scoreB,
    maps: maps.map(row => ({ order: row.mapOrder, label: row.completedAt ? "已有正式结果" : startedIds.has(row.id) ? "已开始" : row.mapOrder > result.clinchingOrder ? "未进行，更正后不再需要" : "尚未开始" })),
    downstreamCount: progression.downstream.length, postTasksExist: imports.length > 0 || stats.length > 0 || reports.length > 0,
    progressionLabel: progression.mode === "major" ? "晋级结果将重新核算，下一轮仍需确认本轮结果" : "晋级结果将重新核算",
    blockers: [...new Set(blockers)],
  };
}

/** Dedicated, reviewed early-completion command. Ordinary correction stays closed. */
export async function correctSeriesAfterMapScoreChangeInTx(tx: TxDb, raw: z.infer<typeof seriesCorrectionConfirmationSchema>, actorId: string) {
  const input = seriesCorrectionConfirmationSchema.parse(raw);
  const match = await lockMatchInTx(tx, input.matchId);
  await assertSeasonAllowsTournamentMutationInTx(tx, match.seasonId);
  const map = await tx.query.matchMaps.findFirst({ where: and(eq(matchMaps.id, input.mapId), eq(matchMaps.matchId, match.id)) });
  if (match.status === "finished" && map?.scoreA === input.scoreA && map.scoreB === input.scoreB) {
    const audit = await tx.query.auditLogs.findMany({ where: and(eq(auditLogs.targetId, match.id), eq(auditLogs.action, "match.series.corrected")) });
    if (audit.some(row => {
      const meta = row.meta as Record<string, unknown> | null;
      return meta?.previewRevision === input.previewRevision && meta.mapId === input.mapId && meta.scoreA === input.scoreA && meta.scoreB === input.scoreB && meta.seriesA === match.scoreA && meta.seriesB === match.scoreB;
    })) return { alreadyApplied: true, finishedSlug: null };
  }
  const request = seriesCorrectionRequestSchema.parse({ matchId: input.matchId, mapId: input.mapId, scoreA: input.scoreA, scoreB: input.scoreB, expectedScoreA: input.expectedScoreA, expectedScoreB: input.expectedScoreB });
  const preview = await planSeriesAfterMapScoreChangeInTx(tx, request);
  if (!preview || preview.revision !== input.previewRevision) throw new AppError(ErrorCode.VALIDATION_FAILED, "比赛事实已变化，请重新预览后确认。");
  if (preview.blockers.length) throw new AppError(ErrorCode.VALIDATION_FAILED, preview.blockers[0]);
  // Use the actual clinching map's recorded end, not the later admin click.
  const maps = await tx.query.matchMaps.findMany({ where: eq(matchMaps.matchId, match.id) });
  const result = planEarlySeriesFinish(match.format, maps, request)!;
  await tx.update(matchMaps).set({ scoreA: input.scoreA, scoreB: input.scoreB }).where(eq(matchMaps.id, input.mapId));
  const finishedSlug = await finishCanonicalSeriesInTx(tx, { match, scoreA: preview.scoreA, scoreB: preview.scoreB, completedAt: result.completedAt, preserveMapPlans: true });
  // Revision owner rejects old Demo/projections immediately; raw evidence and
  // OCR gameplay facts are retained, just as in ordinary map correction.
  await tx.update(matchLiveSessions).set({ autoCanonicalizationArmed: false, continuityHealth: "result_conflict" }).where(and(eq(matchLiveSessions.matchId, match.id), isNull(matchLiveSessions.closedAt)));
  await writeAuditInTx(tx, { seasonId: match.seasonId, actorId, action: "match.series.corrected", targetId: match.id,
    meta: { previewRevision: input.previewRevision, mapId: input.mapId, mapOrder: preview.correctedMapOrder, prevScoreA: preview.oldA, prevScoreB: preview.oldB, scoreA: input.scoreA, scoreB: input.scoreB, seriesA: preview.scoreA, seriesB: preview.scoreB, completedAt: result.completedAt.toISOString(), reason: input.reason, laterMapsNotStarted: true } });
  return { alreadyApplied: false, finishedSlug };
}
