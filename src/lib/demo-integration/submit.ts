import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";

import type { TxDb } from "@/db/client";
import { db } from "@/db/client";
import {
  matchDemoImports,
  matchMaps,
  matchPlayerStats,
  matches,
  matchRoundFacts,
  userGameplaySteamIds,
  type DakPairing,
} from "@/db/schema";
import { writeAuditInTx } from "@/lib/audit/write";
import { AppError, ErrorCode } from "@/lib/errors";
import { parseRivalHubDemoEvidenceV1 } from "@/lib/demo-evidence/contract";
import { loadEffectiveMatchRoster, type EffectiveMatchRosterPlayer } from "@/lib/match-rosters/effective";
import { resolveGameplayUsersBySteam64, type GameplayUserResolution } from "@/lib/identity/gameplay-steam";
import { pairingCanReadSeason } from "./pairing";
import { type IntegrationIssue, type EvidenceSubmissionResponse, type RivalHubEvidenceSubmission } from "./contracts";
import { buildEvidenceRevisionForTarget, sha256Json } from "./revision";
import { dakSemanticProfileIssueMessage, isCurrentDakSemanticProfile } from "./semantic-profile";

export interface SubmitEvidenceArgs {
  input: unknown;
  pairingId: string;
  pairingScope: Pick<DakPairing, "seasonIds">;
  idempotencyKey?: string | null;
}

interface CanonicalTarget {
  match: typeof matches.$inferSelect;
  map: typeof matchMaps.$inferSelect;
  roster: EffectiveMatchRosterPlayer[];
}

interface CanonicalValidation {
  issues: IntegrationIssue[];
  resolutions: Map<string, GameplayUserResolution>;
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

  const roster = await loadEffectiveMatchRoster(tx, [match.id]);

  return { match, map, roster };
}

async function validateCanonicalTarget(
  tx: TxDb,
  evidence: RivalHubEvidenceSubmission,
  target: CanonicalTarget,
): Promise<CanonicalValidation> {
  const { match, map, roster } = target;
  const issues: IntegrationIssue[] = [];
  if (!isCurrentDakSemanticProfile(evidence.contract.semanticProfile)) {
    issues.push(issue(
      "UNSUPPORTED_SEMANTIC_PROFILE",
      dakSemanticProfileIssueMessage(evidence.contract.semanticProfile),
      "contract.semanticProfile",
    ));
  }
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

  const rosterByUser = new Map<string, CanonicalTarget["roster"][number]>();
  const rosterBySteam = new Map<string, CanonicalTarget["roster"][number]>();
  const activeAliasUsers = roster.length > 0
    ? await tx.select({ userId: userGameplaySteamIds.userId })
      .from(userGameplaySteamIds)
      .where(and(
        eq(userGameplaySteamIds.status, "active"),
        inArray(userGameplaySteamIds.userId, [...new Set(roster.map((member) => member.userId))]),
      ))
    : [];
  const activeAliasUserIds = new Set(activeAliasUsers.map((row) => row.userId));
  for (const member of roster) {
    if (!/^\d{17}$/.test(member.steam64 ?? "") && !activeAliasUserIds.has(member.userId)) {
      issues.push(issue("ROSTER_STEAM64_MISSING", "本场首发成员缺少可校验的 Steam64。", "roster"));
    }
    if (member.steam64 && /^\d{17}$/.test(member.steam64)) {
      if (rosterBySteam.has(member.steam64)) issues.push(issue("ROSTER_STEAM64_DUPLICATE", "本场首发存在重复 Steam64。", "roster"));
      rosterBySteam.set(member.steam64, member);
    }
    if (rosterByUser.has(member.userId)) issues.push(issue("ROSTER_USER_DUPLICATE", "本场首发存在重复用户。", "roster"));
    rosterByUser.set(member.userId, member);
  }
  if (roster.length !== evidence.participants.length) issues.push(issue("ROSTER_SIZE_MISMATCH", "Demo 选手数必须等于本场首发人数。", "participants"));
  if (roster.length !== 10) issues.push(issue("ROSTER_NOT_COMPLETE", "当前自动接收要求本场双方各 5 名首发。", "roster"));

  const resolutions = await resolveGameplayUsersBySteam64(tx, evidence.participants.map((participant) => participant.steamId64));
  const participantUsers = new Set<string>();
  for (const participant of evidence.participants) {
    const resolution = resolutions.get(participant.steamId64);
    const expected = resolution ? rosterByUser.get(resolution.userId) : undefined;
    if (!expected) {
      issues.push(issue("PARTICIPANT_NOT_IN_ROSTER", "Demo Steam64 不在本场首发名单中。", `participants.${participant.steamId64}`));
      continue;
    }
    const expectedTeam = expected.entryId === match.entryAId ? "teamA" : expected.entryId === match.entryBId ? "teamB" : null;
    if (expectedTeam !== participant.observedTeamKey) issues.push(issue("PARTICIPANT_TEAM_MISMATCH", "Demo 队伍与本场首发名单不一致。", `participants.${participant.steamId64}`));
    if (participantUsers.has(expected.userId)) issues.push(issue("PARTICIPANT_USER_DUPLICATE", "Demo 中同一位本场首发选手出现了多个 Steam64。", `participants.${participant.steamId64}`));
    participantUsers.add(expected.userId);
  }
  for (const member of rosterByUser.values()) if (!participantUsers.has(member.userId)) issues.push(issue("ROSTER_PARTICIPANT_MISSING", "本场首发成员未出现在 Demo participant 集合中。", "participants"));
  return { issues, resolutions };
}

async function insertRoundFacts(tx: TxDb, importId: string, evidence: RivalHubEvidenceSubmission): Promise<void> {
  if (evidence.sourceFacts.rounds.length === 0) return;
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
  }))).onConflictDoNothing();
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export type ScoreboardStatField = "kills" | "deaths" | "assists" | "hsPercent" | "firstKills" | "multiKills" | "clutches" | "adr";
type PlayerMapSummary = RivalHubEvidenceSubmission["summaries"]["playerMaps"][number];

/**
 * Project DAK-owned map-stat columns from the producer-owned playerMap summary.
 * FK is a won opening duel, MK is the sum of 2K/3K/4K/5K rounds (with DAK's 5K
 * bucket meaning >=5), and clutches counts won clutch attempts.
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

async function projectPlayerStats(
  tx: TxDb,
  importId: string,
  evidence: RivalHubEvidenceSubmission,
  target: CanonicalTarget,
  verifiedBy: string,
  resolutions: ReadonlyMap<string, GameplayUserResolution>,
): Promise<number> {
  const existing = await tx.select().from(matchPlayerStats).where(eq(matchPlayerStats.mapId, target.map.id)).for("update");
  const byUser = new Map(existing.filter((row) => row.userId != null).map((row) => [row.userId!, row]));
  const byName = new Map(existing.map((row) => [row.perfectName, row]));
  const participantBySteam = new Map(evidence.participants.map((participant) => [participant.steamId64, participant]));
  let count = 0;
  for (const summary of evidence.summaries.playerMaps) {
    const participant = participantBySteam.get(summary.steamId64);
    const resolution = resolutions.get(summary.steamId64);
    if (!participant || !resolution) continue;
    const userId = resolution.userId;
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
      verifiedByAdmin: verifiedBy,
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
  actor: {
    auditActorId: string;
    verifiedBy: string;
    auditAction: "match.demo.auto_confirm" | "match.demo.recheck";
  },
  resolutions: ReadonlyMap<string, GameplayUserResolution>,
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
  await projectPlayerStats(tx, row.id, evidence, target, actor.verifiedBy, resolutions);
  await writeAuditInTx(tx, {
    seasonId: target.match.seasonId,
    action: actor.auditAction,
    actorId: actor.auditActorId,
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

export interface StoredDemoRevalidationArgs {
  importId: string;
  actorId: string;
  verifiedBy: string;
}

export interface StoredDemoRevalidationResult {
  status: typeof matchDemoImports.$inferSelect["status"];
  issues: IntegrationIssue[];
}

/**
 * Recheck an already stored current-profile artifact. The payload is parsed
 * for validation only; it is never rewritten and the normal confirmation
 * projection remains the single promotion owner.
 */
export async function revalidateStoredDemoImportInTx(
  tx: TxDb,
  args: StoredDemoRevalidationArgs,
): Promise<StoredDemoRevalidationResult> {
  const [row] = await tx.select().from(matchDemoImports)
    .where(eq(matchDemoImports.id, args.importId))
    .for("update");
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, "待处理的 Demo 数据不存在。");
  if (row.status !== "needs_attention") {
    return { status: row.status, issues: (row.issues ?? []) as IntegrationIssue[] };
  }
  if (!isCurrentDakSemanticProfile(row.semanticProfile)) {
    return {
      status: row.status,
      issues: [issue("UNSUPPORTED_SEMANTIC_PROFILE", dakSemanticProfileIssueMessage(row.semanticProfile), "contract.semanticProfile")],
    };
  }

  let evidence: RivalHubEvidenceSubmission;
  try {
    evidence = parseRivalHubDemoEvidenceV1(row.payload);
  } catch (error) {
    const issues = [issue("STORED_PAYLOAD_INVALID", `已保存的 Demo 数据无法重新校验：${error instanceof Error ? error.message : "格式不合法"}`, "payload")];
    await tx.update(matchDemoImports).set({ status: "needs_attention", issues }).where(eq(matchDemoImports.id, row.id));
    return { status: "needs_attention", issues };
  }

  if (
    evidence.target.seasonId !== row.seasonId
    || evidence.target.matchId !== row.matchId
    || evidence.target.matchMapId !== row.matchMapId
  ) {
    const issues = [issue("STORED_TARGET_MISMATCH", "已保存的 Demo 数据目标已变化，不能自动确认。", "target")];
    await tx.update(matchDemoImports).set({ status: "needs_attention", issues }).where(eq(matchDemoImports.id, row.id));
    return { status: "needs_attention", issues };
  }

  const target = await loadCanonicalTarget(tx, evidence);
  const validation = await validateCanonicalTarget(tx, evidence, target);
  const issues = validation.issues;
  const currentRevision = buildEvidenceRevisionForTarget(target);
  if (evidence.target.evidenceRevision !== currentRevision) {
    issues.push(issue("STALE_EVIDENCE", "Demo Evidence 基于旧的赛事/阵容/比分快照，请刷新后重新生成。", "target.evidenceRevision"));
  }

  if (issues.length > 0) {
    await tx.update(matchDemoImports).set({ status: "needs_attention", issues }).where(eq(matchDemoImports.id, row.id));
    await writeAuditInTx(tx, {
      seasonId: target.match.seasonId,
      action: "match.demo.recheck",
      actorId: args.actorId,
      targetId: row.id,
      meta: { mapOrder: target.map.mapOrder, playerCount: evidence.participants.length, confirmed: false, issueCount: issues.length },
    });
    return { status: "needs_attention", issues };
  }

  await confirmImport(
    tx,
    row,
    evidence,
    target,
    { auditActorId: args.actorId, verifiedBy: args.verifiedBy, auditAction: "match.demo.recheck" },
    validation.resolutions,
    true,
  );
  return { status: "confirmed", issues: [] };
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
    const currentRevision = buildEvidenceRevisionForTarget(target);
    const validation = await validateCanonicalTarget(tx, evidence, target);
    const issues = validation.issues;
    if (evidence.target.evidenceRevision !== currentRevision) issues.push(issue("STALE_EVIDENCE", "Demo Evidence 基于旧的赛事/阵容/比分快照，请刷新后重新生成。", "target.evidenceRevision"));

    const priorRows = await tx.select().from(matchDemoImports)
      .where(eq(matchDemoImports.matchMapId, target.map.id)).orderBy(desc(matchDemoImports.createdAt)).for("update");
    const same = idempotent ?? priorRows.find((row) => sameContent(row, evidence, payloadSha256));
    // Content conflict is owned by every confirmed import, including retired semantic profiles.
    const confirmedPrior = priorRows.find((row) => row.status === "confirmed" && row.id !== same?.id);
    // Same-demo lineage may replace a confirmed, needs-attention, or stale snapshot;
    // rejected and pending rows remain explicit workflow states.
    const sameDemoPrior = priorRows.find((row) =>
      row.demoSha256 === evidence.source.demoSha256
      && ["confirmed", "needs_attention", "stale"].includes(row.status)
      && row.id !== same?.id,
    );
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
        await confirmImport(
          tx,
          same,
          evidence,
          target,
          { auditActorId: `dak:${args.pairingId}`, verifiedBy: `dak:${args.pairingId}`, auditAction: "match.demo.auto_confirm" },
          validation.resolutions,
          true,
          sameDemoPrior?.id ?? null,
        );
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
      supersedesImportId: status === "confirmed" ? sameDemoPrior?.id ?? null : null,
      issues,
      confirmedAt: status === "confirmed" ? now : null,
    }).returning();
    if (!created) throw new AppError(ErrorCode.INTERNAL_ERROR, "保存 Demo Evidence 失败。");

    if (status === "confirmed") {
      await confirmImport(
        tx,
        created,
        evidence,
        target,
        { auditActorId: `dak:${args.pairingId}`, verifiedBy: `dak:${args.pairingId}`, auditAction: "match.demo.auto_confirm" },
        validation.resolutions,
        false,
        sameDemoPrior?.id ?? null,
      );
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
