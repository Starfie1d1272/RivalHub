import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import {
  matchDemoImports,
  matchMaps,
  matches,
  userGameplaySteamIds,
} from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { resolveGameplayUsersBySteam64InTx, type GameplayUserResolution } from "@/lib/identity/gameplay-steam";
import { loadEffectiveMatchRoster, type EffectiveMatchRosterPlayer } from "@/lib/match-rosters/effective";
import type { IntegrationIssue, RivalHubEvidenceSubmission } from "./contracts";
import { dakSemanticProfileIssueMessage, isCurrentDakSemanticProfile } from "./semantic-profile";

export interface CanonicalTarget {
  match: typeof matches.$inferSelect;
  map: typeof matchMaps.$inferSelect;
  roster: EffectiveMatchRosterPlayer[];
}

export interface CanonicalValidationResult {
  issues: IntegrationIssue[];
  resolutions: Map<string, GameplayUserResolution>;
  rosterBySteam64: Map<string, EffectiveMatchRosterPlayer>;
}

const CONFIRMABLE_PARTICIPANT_IDENTITY_ISSUE = "PARTICIPANT_IDENTITY_UNRESOLVED";

export function hasConfirmableParticipantIdentityIssue(
  issues: readonly IntegrationIssue[],
  observedSteam64: string,
): boolean {
  const path = `participants.${observedSteam64}`;
  return issues.some((issue) => issue.code === CONFIRMABLE_PARTICIPANT_IDENTITY_ISSUE && issue.path === path);
}

export function integrationIssue(code: string, message: string, path?: string): IntegrationIssue {
  return path ? { code, path, message } : { code, message };
}

export async function loadCanonicalTarget(
  tx: TxDb,
  target: Pick<RivalHubEvidenceSubmission["target"], "seasonId" | "matchId" | "matchMapId">,
): Promise<CanonicalTarget> {
  const [match] = await tx.select().from(matches)
    .where(and(eq(matches.id, target.matchId), eq(matches.seasonId, target.seasonId)))
    .for("update");
  if (!match) throw new AppError(ErrorCode.NOT_FOUND, "目标比赛不存在或不属于该赛季。");

  const [map] = await tx.select().from(matchMaps)
    .where(and(eq(matchMaps.id, target.matchMapId), eq(matchMaps.matchId, match.id)));
  if (!map) throw new AppError(ErrorCode.NOT_FOUND, "目标地图不存在或不属于该比赛。");

  const roster = await loadEffectiveMatchRoster(tx, [match.id]);
  return { match, map, roster };
}

export async function validateCanonicalTarget(
  tx: TxDb,
  evidence: RivalHubEvidenceSubmission,
  target: CanonicalTarget,
): Promise<CanonicalValidationResult> {
  const { match, map, roster } = target;
  const issues: IntegrationIssue[] = [];

  if (!isCurrentDakSemanticProfile(evidence.contract.semanticProfile)) {
    issues.push(integrationIssue(
      "UNSUPPORTED_SEMANTIC_PROFILE",
      dakSemanticProfileIssueMessage(evidence.contract.semanticProfile),
      "contract.semanticProfile",
    ));
  }
  if (evidence.target.stageKey !== match.stage) issues.push(integrationIssue("TARGET_STAGE_MISMATCH", "目标阶段已变化。", "target.stageKey"));
  if ((evidence.target.stageRunId ?? null) !== match.majorStageRunId) issues.push(integrationIssue("TARGET_STAGE_RUN_MISMATCH", "目标 StageRun 已变化。", "target.stageRunId"));
  if (evidence.target.mapOrder !== map.mapOrder) issues.push(integrationIssue("TARGET_MAP_ORDER_MISMATCH", "目标图序已变化。", "target.mapOrder"));
  if (evidence.target.expectedMapName !== map.mapName) issues.push(integrationIssue("TARGET_MAP_MISMATCH", "目标地图已变化。", "target.expectedMapName"));
  if (evidence.target.entryAId !== match.entryAId || evidence.target.entryBId !== match.entryBId) issues.push(integrationIssue("TARGET_ENTRY_MISMATCH", "目标参赛队已变化。", "target.entryAId"));
  if (match.status !== "finished" || match.completedAt == null) issues.push(integrationIssue("MATCH_NOT_FINISHED", "比赛尚未形成可接收的正式结果。", "target.matchId"));
  if (map.scoreA == null || map.scoreB == null || map.completedAt == null) issues.push(integrationIssue("MAP_RESULT_MISSING", "目标地图缺少已完成的正式比分。", "target.matchMapId"));
  if (evidence.quality.qa.ok !== true) issues.push(integrationIssue("DAK_QA_FAILED", "DAK QA 未通过，不能自动接收。", "quality.qa"));

  const teamARounds = evidence.sourceFacts.rounds.filter((row) => row.winnerTeamKey === "teamA").length;
  const teamBRounds = evidence.sourceFacts.rounds.filter((row) => row.winnerTeamKey === "teamB").length;
  if (map.scoreA != null && teamARounds !== map.scoreA) issues.push(integrationIssue("SCORE_MISMATCH", "Demo 回合胜负与 RivalHub 正式比分不一致。", "sourceFacts.rounds"));
  if (map.scoreB != null && teamBRounds !== map.scoreB) issues.push(integrationIssue("SCORE_MISMATCH", "Demo 回合胜负与 RivalHub 正式比分不一致。", "sourceFacts.rounds"));
  const teamSummaries = new Map(evidence.summaries.teamMaps.map((row) => [row.teamKey, row]));
  if (map.scoreA != null && teamSummaries.get("teamA")?.roundWins !== map.scoreA) issues.push(integrationIssue("SUMMARY_SCORE_MISMATCH", "Demo teamMaps 与 RivalHub 正式比分不一致。", "summaries.teamMaps"));
  if (map.scoreB != null && teamSummaries.get("teamB")?.roundWins !== map.scoreB) issues.push(integrationIssue("SUMMARY_SCORE_MISMATCH", "Demo teamMaps 与 RivalHub 正式比分不一致。", "summaries.teamMaps"));

  const rosterUserIds = new Set<string>();
  const rosterByUser = new Map<string, EffectiveMatchRosterPlayer>();
  const rosterIdentityValues = new Map<string, string>();
  for (const member of roster) {
    if (rosterUserIds.has(member.userId)) issues.push(integrationIssue("ROSTER_USER_DUPLICATE", "本场首发存在重复用户。", "roster"));
    rosterUserIds.add(member.userId);
    rosterByUser.set(member.userId, member);
    if (member.steam64 && /^\d{17}$/.test(member.steam64)) {
      const previous = rosterIdentityValues.get(member.steam64);
      if (previous && previous !== member.userId) issues.push(integrationIssue("ROSTER_STEAM64_DUPLICATE", "本场首发存在重复 Steam64。", "roster"));
      rosterIdentityValues.set(member.steam64, member.userId);
    }
  }
  if (roster.length !== evidence.participants.length) issues.push(integrationIssue("ROSTER_SIZE_MISMATCH", "Demo 选手数必须等于本场首发人数。", "participants"));
  if (roster.length !== 10) issues.push(integrationIssue("ROSTER_NOT_COMPLETE", "当前自动接收要求本场双方各 5 名首发。", "roster"));

  const activeAliasRows = rosterUserIds.size === 0
    ? []
    : await tx.select({ userId: userGameplaySteamIds.userId, steam64: userGameplaySteamIds.steam64 })
      .from(userGameplaySteamIds)
      .where(and(eq(userGameplaySteamIds.status, "active"), inArray(userGameplaySteamIds.userId, [...rosterUserIds])));
  const identitiesByUser = new Map<string, Set<string>>();
  for (const member of roster) {
    const values = identitiesByUser.get(member.userId) ?? new Set<string>();
    if (member.steam64 && /^\d{17}$/.test(member.steam64)) values.add(member.steam64);
    identitiesByUser.set(member.userId, values);
  }
  for (const row of activeAliasRows) identitiesByUser.get(row.userId)?.add(row.steam64);
  for (const userId of rosterUserIds) {
    if ((identitiesByUser.get(userId)?.size ?? 0) === 0) issues.push(integrationIssue("ROSTER_STEAM64_MISSING", "本场首发成员缺少可校验的 Steam64。", "roster"));
  }

  const resolutions = await resolveGameplayUsersBySteam64InTx(tx, evidence.participants.map((participant) => participant.steamId64));
  const participantUsers = new Set<string>();
  const rosterBySteam64 = new Map<string, EffectiveMatchRosterPlayer>();
  for (const participant of evidence.participants) {
    const path = `participants.${participant.steamId64}`;
    const resolution = resolutions.get(participant.steamId64);
    if (!resolution) {
      issues.push(integrationIssue("PARTICIPANT_IDENTITY_UNRESOLVED", "选手身份未能以 Steam64 唯一匹配，不能自动接收。", path));
      continue;
    }
    const expected = rosterByUser.get(resolution.userId);
    if (!expected) {
      issues.push(integrationIssue("PARTICIPANT_NOT_IN_ROSTER", "Demo Steam64 不属于本场已确认首发名单。", path));
      continue;
    }
    participantUsers.add(resolution.userId);
    rosterBySteam64.set(participant.steamId64, expected);
    const expectedTeam = expected.entryId === match.entryAId ? "teamA" : expected.entryId === match.entryBId ? "teamB" : null;
    if (expectedTeam === null) issues.push(integrationIssue("ROSTER_ENTRY_INVALID", "本场首发所属参赛队无效。", "roster"));
    if (expectedTeam !== participant.observedTeamKey) issues.push(integrationIssue("PARTICIPANT_TEAM_MISMATCH", "Demo 队伍与本场首发名单不一致。", path));
  }
  for (const member of roster) {
    if (!participantUsers.has(member.userId)) issues.push(integrationIssue("ROSTER_PARTICIPANT_MISSING", "本场首发成员未出现在 Demo participant 集合中。", "participants"));
  }

  return { issues, resolutions, rosterBySteam64 };
}

export function currentValidationResponseIssue(message: string): IntegrationIssue {
  return integrationIssue("STORED_PAYLOAD_INVALID", message);
}

export type StoredDemoImport = typeof matchDemoImports.$inferSelect;
