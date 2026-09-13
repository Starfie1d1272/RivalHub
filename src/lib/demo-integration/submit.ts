import "server-only";

import { and, desc, eq } from "drizzle-orm";

import type { TxDb } from "@/db/client";
import { db } from "@/db/client";
import {
  eventRosterMembers,
  matchDemoImports,
  matchMaps,
  matchPlayerStats,
  matchRosterPlayers,
  matchRosters,
  matches,
  users,
  matchRoundFacts,
  type DakPairing,
} from "@/db/schema";
import { writeAuditInTx } from "@/lib/audit/write";
import { AppError, ErrorCode } from "@/lib/errors";
import { parseRivalHubDemoEvidenceV1 } from "@/lib/demo-evidence/contract";
import { pairingCanReadSeason } from "./pairing";
import { type IntegrationIssue, type EvidenceSubmissionResponse, type RivalHubEvidenceSubmission } from "./contracts";
import { buildEvidenceRevision, sha256Json, type EvidenceRevisionRosterMember } from "./revision";

export interface SubmitEvidenceArgs {
  input: unknown;
  pairingId: string;
  pairingScope: Pick<DakPairing, "seasonIds">;
  idempotencyKey?: string | null;
}

interface CanonicalTarget {
  match: typeof matches.$inferSelect;
  map: typeof matchMaps.$inferSelect;
  roster: Array<{
    entryId: string;
    eventRosterMemberId: string;
    userId: string;
    steam64: string | null;
    isStarter: boolean;
  }>;
}

function issue(code: string, message: string, path?: string): IntegrationIssue {
  return path ? { code, path, message } : { code, message };
}

function statusOf(row: typeof matchDemoImports.$inferSelect): EvidenceSubmissionResponse["status"] {
  return row.status === "confirmed" ? "synced" : "needs_attention";
}

export function assertEvidenceSeasonInPairingScope(
  pairing: Pick<DakPairing, "seasonIds">,
  seasonId: string,
): void {
  if (!pairingCanReadSeason(pairing, seasonId)) {
    throw new AppError(ErrorCode.FORBIDDEN, "DAK 连接无权提交该赛季的 Demo Evidence。");
  }
}

async function loadCanonicalTarget(tx: TxDb, evidence: RivalHubEvidenceSubmission): Promise<CanonicalTarget> {
  const [match] = await tx.select().from(matches)
    .where(and(eq(matches.id, evidence.target.matchId), eq(matches.seasonId, evidence.target.seasonId)))
    .for("update");
  if (!match) throw new AppError(ErrorCode.NOT_FOUND, "目标比赛不存在或不属于该赛季。");

  const [map] = await tx.select().from(matchMaps)
    .where(and(eq(matchMaps.id, evidence.target.matchMapId), eq(matchMaps.matchId, match.id)));
  if (!map) throw new AppError(ErrorCode.NOT_FOUND, "目标地图不存在或不属于该比赛。");

  const roster = await tx.select({
    entryId: matchRosters.entryId,
    eventRosterMemberId: eventRosterMembers.id,
    userId: users.id,
    steam64: users.steam64,
    isStarter: matchRosterPlayers.isStarter,
  }).from(matchRosterPlayers)
    .innerJoin(matchRosters, eq(matchRosters.id, matchRosterPlayers.rosterId))
    .innerJoin(eventRosterMembers, eq(eventRosterMembers.id, matchRosterPlayers.eventRosterMemberId))
    .innerJoin(users, eq(users.id, eventRosterMembers.userId))
    .where(and(
      eq(matchRosters.matchId, match.id),
      eq(matchRosters.status, "confirmed"),
      eq(matchRosterPlayers.isStarter, true),
    ));

  return { match, map, roster };
}

function validateCanonicalTarget(
  evidence: RivalHubEvidenceSubmission,
  target: CanonicalTarget,
): IntegrationIssue[] {
  const { match, map, roster } = target;
  const issues: IntegrationIssue[] = [];
  if (evidence.contract.semanticProfile !== "dak-stable/1") issues.push(issue("UNSUPPORTED_SEMANTIC_PROFILE", "当前 RivalHub 只接受 dak-stable/1。", "contract.semanticProfile"));
  if (evidence.target.stageKey !== match.stage) issues.push(issue("TARGET_STAGE_MISMATCH", "目标阶段已变化。", "target.stageKey"));
  if ((evidence.target.stageRunId ?? null) !== match.majorStageRunId) issues.push(issue("TARGET_STAGE_RUN_MISMATCH", "目标 StageRun 已变化。", "target.stageRunId"));
  if (evidence.target.mapOrder !== map.mapOrder) issues.push(issue("TARGET_MAP_ORDER_MISMATCH", "目标图序已变化。", "target.mapOrder"));
  if (evidence.target.expectedMapName !== map.mapName) issues.push(issue("TARGET_MAP_MISMATCH", "目标地图已变化。", "target.expectedMapName"));
  if (evidence.target.entryAId !== match.entryAId || evidence.target.entryBId !== match.entryBId) issues.push(issue("TARGET_ENTRY_MISMATCH", "目标参赛队已变化。", "target.entryAId"));
  if (match.status !== "finished" || match.completedAt == null) issues.push(issue("MATCH_NOT_FINISHED", "比赛尚未形成可接收的正式结果。", "target.matchId"));
  if (map.scoreA == null || map.scoreB == null || map.completedAt == null) issues.push(issue("MAP_RESULT_MISSING", "目标地图缺少已完成的正式比分。", "target.matchMapId"));
  if (evidence.quality.qa.ok !== true) issues.push(issue("DAK_QA_FAILED", "DAK QA 未通过，不能自动接收。", "quality.qa"));

  const teamARounds = evidence.sourceFacts.rounds.filter((row) => row.winnerTeamKey === "teamA").length;
  const teamBRounds = evidence.sourceFacts.rounds.filter((row) => row.winnerTeamKey === "teamB").length;
  if (map.scoreA != null && teamARounds !== map.scoreA) issues.push(issue("SCORE_MISMATCH", "Demo 回合胜负与 RivalHub 正式比分不一致。", "sourceFacts.rounds"));
  if (map.scoreB != null && teamBRounds !== map.scoreB) issues.push(issue("SCORE_MISMATCH", "Demo 回合胜负与 RivalHub 正式比分不一致。", "sourceFacts.rounds"));
  const teamSummaries = new Map(evidence.summaries.teamMaps.map((row) => [row.teamKey, row]));
  if (map.scoreA != null && teamSummaries.get("teamA")?.roundWins !== map.scoreA) issues.push(issue("SUMMARY_SCORE_MISMATCH", "Demo teamMaps 与 RivalHub 正式比分不一致。", "summaries.teamMaps"));
  if (map.scoreB != null && teamSummaries.get("teamB")?.roundWins !== map.scoreB) issues.push(issue("SUMMARY_SCORE_MISMATCH", "Demo teamMaps 与 RivalHub 正式比分不一致。", "summaries.teamMaps"));

  const rosterBySteam = new Map<string, CanonicalTarget["roster"][number]>();
  const rosterUserIds = new Set<string>();
  for (const member of roster) {
    if (!/^\d{17}$/.test(member.steam64 ?? "")) {
      issues.push(issue("ROSTER_STEAM64_MISSING", "Canonical MatchRoster 成员缺少可校验的 Steam64。", "roster"));
      continue;
    }
    if (rosterBySteam.has(member.steam64!)) issues.push(issue("ROSTER_STEAM64_DUPLICATE", "Canonical MatchRoster 存在重复 Steam64。", "roster"));
    rosterBySteam.set(member.steam64!, member);
    if (rosterUserIds.has(member.userId)) issues.push(issue("ROSTER_USER_DUPLICATE", "Canonical MatchRoster 存在重复用户。", "roster"));
    rosterUserIds.add(member.userId);
  }
  if (roster.length !== evidence.participants.length) issues.push(issue("ROSTER_SIZE_MISMATCH", "Demo 选手数必须等于已确认的 Canonical MatchRoster 首发数。", "participants"));
  if (roster.length !== 10) issues.push(issue("ROSTER_NOT_COMPLETE", "当前自动接收要求双方各 5 名已确认首发。", "roster"));

  const participants = new Set<string>();
  for (const participant of evidence.participants) {
    participants.add(participant.steamId64);
    const expected = rosterBySteam.get(participant.steamId64);
    if (!expected) {
      issues.push(issue("PARTICIPANT_NOT_IN_ROSTER", "Demo Steam64 不在当前 Canonical MatchRoster 中。", `participants.${participant.steamId64}`));
      continue;
    }
    const expectedTeam = expected.entryId === match.entryAId ? "teamA" : expected.entryId === match.entryBId ? "teamB" : null;
    if (expectedTeam !== participant.observedTeamKey) issues.push(issue("PARTICIPANT_TEAM_MISMATCH", "Demo 队伍与 Canonical MatchRoster 不一致。", `participants.${participant.steamId64}`));
    if (participant.resolution.status !== "matched") {
      issues.push(issue("PARTICIPANT_IDENTITY_UNRESOLVED", "选手身份未能以 Steam64 唯一匹配，不能自动接收。", `participants.${participant.steamId64}`));
      continue;
    }
    if (participant.resolution.userId !== expected.userId || participant.resolution.eventRosterMemberId !== expected.eventRosterMemberId || participant.resolution.entryId !== expected.entryId) {
      issues.push(issue("PARTICIPANT_IDENTITY_MISMATCH", "Demo 身份映射与 Canonical MatchRoster 不一致。", `participants.${participant.steamId64}`));
    }
  }
  for (const steam64 of rosterBySteam.keys()) if (!participants.has(steam64)) issues.push(issue("ROSTER_PARTICIPANT_MISSING", "Canonical MatchRoster 成员未出现在 Demo participant 集合中。", "participants"));
  return issues;
}

async function insertRoundFacts(tx: TxDb, importId: string, evidence: RivalHubEvidenceSubmission): Promise<void> {
  await tx.insert(matchRoundFacts).values(evidence.sourceFacts.rounds.map((row) => ({
    importId,
    roundSeq: row.roundSeq,
    sourceRoundNumber: row.sourceRoundNumber,
    phase: row.phase,
    startTick: row.startTick,
    freezeEndTick: row.freezeEndTick,
    endTick: row.endTick,
    teamASide: row.teamASide,
    teamBSide: row.teamBSide,
    teamAScoreBefore: row.teamAScoreBefore,
    teamBScoreBefore: row.teamBScoreBefore,
    teamAEconomy: row.teamAEconomy,
    teamBEconomy: row.teamBEconomy,
    winnerTeamKey: row.winnerTeamKey,
    winnerSide: row.winnerSide,
    endReason: row.endReason,
  })));
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export type ScoreboardStatField = "kills" | "deaths" | "assists" | "hsPercent" | "firstKills" | "multiKills" | "clutches" | "adr";
type PlayerMapSummary = RivalHubEvidenceSubmission["summaries"]["playerMaps"][number];

/**
 * These are the DAK stable/1 values that have the same meaning as the
 * scoreboard columns. FK is a won opening duel, MK is the sum of 2K/3K/4K/5K
 * rounds (with DAK's 5K bucket meaning >=5), and clutches counts won clutch
 * attempts. Keep this mapping identical to the projection below before using
 * any of these fields as an OCR hard blocker.
 */
export function dakStableScoreboardValues(summary: PlayerMapSummary): Record<ScoreboardStatField, number> {
  return {
    kills: summary.kills,
    deaths: summary.deaths,
    assists: summary.assists,
    hsPercent: summary.kills > 0 ? Math.round((summary.headshots / summary.kills) * 100) : 0,
    firstKills: summary.firstKills,
    multiKills: summary.twoKillRounds + summary.threeKillRounds + summary.fourKillRounds + summary.fiveKillRounds,
    clutches: summary.clutchWins,
    adr: round(summary.damage / Math.max(summary.rounds, 1), 2),
  };
}

/** Perfect scoreboard display precision: integer columns are shown as whole
 * numbers and ADR is shown to one decimal place. Compare the rendered value,
 * not a raw floating-point tolerance. */
export function scoreboardStatDisplay(field: ScoreboardStatField, value: number): string {
  return field === "adr" ? value.toFixed(1) : Math.round(value).toFixed(0);
}

/**
 * OCR is optional evidence. Before the first DAK projection, compare only
 * fields whose source semantics are shared by the scoreboard and DAK. A
 * missing OCR field never blocks; an actual disagreement keeps the import in
 * needs_attention and prevents auto-confirm.
 */
async function crossCheckOcrStats(
  tx: TxDb,
  evidence: RivalHubEvidenceSubmission,
  target: CanonicalTarget,
): Promise<IntegrationIssue[]> {
  const existing = await tx.select({
    userId: matchPlayerStats.userId,
    dakImportId: matchPlayerStats.dakImportId,
    kills: matchPlayerStats.kills,
    deaths: matchPlayerStats.deaths,
    assists: matchPlayerStats.assists,
    hsPercent: matchPlayerStats.hsPercent,
    firstKills: matchPlayerStats.firstKills,
    multiKills: matchPlayerStats.multiKills,
    clutches: matchPlayerStats.clutches,
    adr: matchPlayerStats.adr,
  }).from(matchPlayerStats).where(eq(matchPlayerStats.mapId, target.map.id));
  const ocrByUser = new Map<string, Array<typeof existing[number]>>();
  for (const row of existing) {
    if (!row.userId || row.dakImportId) continue;
    const rows = ocrByUser.get(row.userId) ?? [];
    rows.push(row);
    ocrByUser.set(row.userId, rows);
  }

  const participantBySteam = new Map(evidence.participants.map((participant) => [participant.steamId64, participant]));
  const issues: IntegrationIssue[] = [];
  for (const summary of evidence.summaries.playerMaps) {
    const participant = participantBySteam.get(summary.steamId64);
    if (!participant || participant.resolution.status !== "matched") continue;
    const dakValues = dakStableScoreboardValues(summary);
    const fields = [
      ["kills", "K"],
      ["deaths", "D"],
      ["assists", "A"],
      ["hsPercent", "HS%"],
      ["firstKills", "FK"],
      ["multiKills", "MK"],
      ["clutches", "残局"],
      ["adr", "ADR"],
    ] as const;
    for (const row of ocrByUser.get(participant.resolution.userId) ?? []) {
      for (const [field, label] of fields) {
        const ocrValue = row[field];
        const dakValue = dakValues[field];
        if (ocrValue == null || dakValue == null || !Number.isFinite(ocrValue) || !Number.isFinite(dakValue)) continue;
        const same = scoreboardStatDisplay(field, ocrValue) === scoreboardStatDisplay(field, dakValue);
        if (!same) {
          issues.push(issue(
            "OCR_CONFLICT",
            `OCR ${label} 与 Demo 不一致：OCR=${ocrValue}，Demo=${dakValue}。`,
            `summaries.playerMaps.${summary.steamId64}.${field}`,
          ));
        }
      }
    }
  }
  return issues;
}

async function projectPlayerStats(
  tx: TxDb,
  importId: string,
  evidence: RivalHubEvidenceSubmission,
  target: CanonicalTarget,
  pairingId: string,
): Promise<number> {
  const existing = await tx.select().from(matchPlayerStats).where(eq(matchPlayerStats.mapId, target.map.id)).for("update");
  const byUser = new Map(existing.filter((row) => row.userId != null).map((row) => [row.userId!, row]));
  const byName = new Map(existing.map((row) => [row.perfectName, row]));
  const participantBySteam = new Map(evidence.participants.map((participant) => [participant.steamId64, participant]));
  let count = 0;
  for (const summary of evidence.summaries.playerMaps) {
    const participant = participantBySteam.get(summary.steamId64);
    if (!participant || participant.resolution.status !== "matched") continue;
    const userId = participant.resolution.userId;
    const existingRow = byUser.get(userId) ?? (byName.get(participant.nameSnapshot)?.userId == null ? byName.get(participant.nameSnapshot) : undefined);
    const scoreboardValues = dakStableScoreboardValues(summary);
    const values = {
      matchId: target.match.id,
      mapId: target.map.id,
      perfectName: participant.nameSnapshot,
      userId,
      kills: summary.kills,
      deaths: summary.deaths,
      assists: summary.assists,
      hsPercent: scoreboardValues.hsPercent,
      firstKills: scoreboardValues.firstKills,
      firstDeaths: summary.firstDeaths,
      multiKills: scoreboardValues.multiKills,
      tradeKills: summary.tradeKills,
      kastRounds: summary.kastRounds,
      clutches: scoreboardValues.clutches,
      adr: scoreboardValues.adr,
      dakImportId: importId,
      verifiedByAdmin: `dak:${pairingId}`,
      verifiedAt: new Date(),
    };
    if (existingRow) {
      await tx.update(matchPlayerStats).set(values).where(eq(matchPlayerStats.id, existingRow.id));
    } else {
      await tx.insert(matchPlayerStats).values(values);
    }
    count += 1;
  }
  return count;
}

function revisionFor(target: CanonicalTarget): string {
  const roster: EvidenceRevisionRosterMember[] = target.roster.map((row) => ({
    entryId: row.entryId,
    eventRosterMemberId: row.eventRosterMemberId,
    userId: row.userId,
    steam64: row.steam64,
    isStarter: row.isStarter,
  }));
  return buildEvidenceRevision({
    seasonId: target.match.seasonId,
    stageKey: target.match.stage,
    stageRunId: target.match.majorStageRunId,
    matchId: target.match.id,
    matchMapId: target.map.id,
    mapOrder: target.map.mapOrder,
    mapName: target.map.mapName,
    mapScoreA: target.map.scoreA,
    mapScoreB: target.map.scoreB,
    mapCompletedAt: target.map.completedAt?.toISOString() ?? null,
    matchStatus: target.match.status,
    entryAId: target.match.entryAId,
    entryBId: target.match.entryBId,
    roster,
  });
}

function sameContent(row: typeof matchDemoImports.$inferSelect, evidence: RivalHubEvidenceSubmission, payloadSha256: string): boolean {
  return row.payloadSha256 === payloadSha256 && row.demoSha256 === evidence.source.demoSha256;
}

function responseFor(
  row: typeof matchDemoImports.$inferSelect,
  issues: readonly IntegrationIssue[] = row.issues ?? [],
): EvidenceSubmissionResponse {
  return {
    status: statusOf(row),
    importId: row.id,
    matchMapId: row.matchMapId,
    demoSha256: row.demoSha256,
    issues: [...issues],
  };
}

async function confirmImport(
  tx: TxDb,
  row: typeof matchDemoImports.$inferSelect,
  evidence: RivalHubEvidenceSubmission,
  target: CanonicalTarget,
  pairingId: string,
  retryPromotion: boolean,
  supersededImportId: string | null = null,
): Promise<void> {
  if (supersededImportId) {
    await tx.update(matchDemoImports)
      .set({ status: "superseded" })
      .where(eq(matchDemoImports.id, supersededImportId));
  }
  await tx.update(matchDemoImports).set({
    status: "confirmed",
    issues: [],
    confirmedAt: new Date(),
    ...(supersededImportId ? { supersedesImportId: supersededImportId } : {}),
  }).where(eq(matchDemoImports.id, row.id));
  await insertRoundFacts(tx, row.id, evidence);
  await projectPlayerStats(tx, row.id, evidence, target, pairingId);
  await writeAuditInTx(tx, {
    seasonId: target.match.seasonId,
    action: "match.demo.auto_confirm",
    actorId: `dak:${pairingId}`,
    targetId: row.id,
    meta: {
      mapOrder: target.map.mapOrder,
      playerCount: evidence.participants.length,
      rounds: evidence.sourceFacts.rounds.length,
      ...(retryPromotion ? { retryPromotion: true } : {}),
      ...(supersededImportId ? { supersedesImportId: supersededImportId } : {}),
    },
  });
}

export async function submitRivalHubEvidence(args: SubmitEvidenceArgs): Promise<EvidenceSubmissionResponse> {
  let evidence: RivalHubEvidenceSubmission;
  try {
    evidence = parseRivalHubDemoEvidenceV1(args.input);
  } catch (error) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `Demo Evidence V1 校验失败：${error instanceof Error ? error.message : "格式不合法"}`);
  }
  assertEvidenceSeasonInPairingScope(args.pairingScope, evidence.target.seasonId);
  if (args.idempotencyKey && (args.idempotencyKey.length < 8 || args.idempotencyKey.length > 200)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "Idempotency-Key 长度不合法。");
  }
  const payloadSha256 = sha256Json(evidence);

  return db.transaction(async (tx) => {
    let idempotent: typeof matchDemoImports.$inferSelect | undefined;
    if (args.idempotencyKey) {
      [idempotent] = await tx.select().from(matchDemoImports).where(eq(matchDemoImports.idempotencyKey, args.idempotencyKey)).for("update");
      if (idempotent) {
        if (!sameContent(idempotent, evidence, payloadSha256)) throw new AppError(ErrorCode.VALIDATION_FAILED, "Idempotency-Key 已用于另一份 Demo Evidence。");
      }
    }

    const target = await loadCanonicalTarget(tx, evidence);
    const currentRevision = revisionFor(target);
    const issues = validateCanonicalTarget(evidence, target);
    if (evidence.target.evidenceRevision !== currentRevision) issues.push(issue("STALE_EVIDENCE", "Demo Evidence 基于旧的赛事/阵容/比分快照，请刷新后重新生成。", "target.evidenceRevision"));
    issues.push(...await crossCheckOcrStats(tx, evidence, target));

    const priorRows = await tx.select().from(matchDemoImports)
      .where(eq(matchDemoImports.matchMapId, target.map.id)).orderBy(desc(matchDemoImports.createdAt)).for("update");
    const same = idempotent ?? priorRows.find((row) => sameContent(row, evidence, payloadSha256));
    const confirmedPrior = priorRows.find((row) => row.status === "confirmed" && row.id !== same?.id);
    const sameDemoConfirmed = confirmedPrior?.demoSha256 === evidence.source.demoSha256 ? confirmedPrior : undefined;
    const differentDemoConfirmed = confirmedPrior && confirmedPrior.demoSha256 !== evidence.source.demoSha256 ? confirmedPrior : undefined;
    if (same) {
      if (same.status === "confirmed") {
        if (same.evidenceRevision === currentRevision && issues.length === 0) return responseFor(same, []);
        return { ...responseFor(same, issues), status: "needs_attention" };
      }
      if (differentDemoConfirmed) {
        issues.push(issue("CONTENT_CONFLICT", "该地图已有另一份已确认 Demo；不同内容必须显式进入冲突处理，不能静默覆盖。", "source.demoSha256"));
      }
      if (same.status === "needs_attention" && issues.length === 0) {
        await confirmImport(tx, same, evidence, target, args.pairingId, true, sameDemoConfirmed?.id ?? null);
        return { ...responseFor({ ...same, status: "confirmed" }), status: "synced", issues: [] };
      }
      await tx.update(matchDemoImports).set({ issues }).where(eq(matchDemoImports.id, same.id));
      return responseFor(same, issues);
    }
    if (differentDemoConfirmed) issues.push(issue("CONTENT_CONFLICT", "该地图已有另一份已确认 Demo；不同内容必须显式进入冲突处理，不能静默覆盖。", "source.demoSha256"));

    const now = new Date();
    const status = issues.length > 0 ? "needs_attention" : "confirmed";
    const [created] = await tx.insert(matchDemoImports).values({
      seasonId: target.match.seasonId,
      matchId: target.match.id,
      matchMapId: target.map.id,
      stageKey: target.match.stage,
      stageRunId: target.match.majorStageRunId,
      demoSha256: evidence.source.demoSha256,
      payloadSha256,
      contractVersion: evidence.contract.contractVersion,
      semanticProfile: evidence.contract.semanticProfile,
      analysisVersion: evidence.contract.analysisVersion,
      evidenceRevision: evidence.target.evidenceRevision,
      status,
      payload: evidence,
      submittedByPairingId: args.pairingId,
      idempotencyKey: args.idempotencyKey ?? null,
      supersedesImportId: status === "confirmed" ? sameDemoConfirmed?.id ?? null : null,
      issues,
      confirmedAt: status === "confirmed" ? now : null,
    }).returning();
    if (!created) throw new AppError(ErrorCode.INTERNAL_ERROR, "保存 Demo Evidence 失败。");

    if (status === "confirmed") {
      await confirmImport(tx, created, evidence, target, args.pairingId, false, sameDemoConfirmed?.id ?? null);
    } else {
      await writeAuditInTx(tx, {
        seasonId: target.match.seasonId,
        action: "match.demo.needs_attention",
        actorId: `dak:${args.pairingId}`,
        targetId: created.id,
        meta: { mapOrder: target.map.mapOrder, playerCount: evidence.participants.length, issueCount: issues.length },
      });
    }
    return { status: status === "confirmed" ? "synced" : "needs_attention", importId: created.id, matchMapId: created.matchMapId, demoSha256: created.demoSha256, issues };
  });
}
