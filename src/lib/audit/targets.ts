import { inArray } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { db } from "@/db/client";
import {
  adminInvites,
  communityAwardEvidence,
  communityAwards,
  competitionEntries,
  competitivePlatformRanks,
  competitivePlatforms,
  competitivePlatformSeasons,
  disciplinaryCases,
  draftPicks,
  draftState,
  educationVerifications,
  institutions,
  majorFinalResults,
  majorPrestartIssues,
  majorPrestartStates,
  majorStageRuns,
  majorTournamentEntrants,
  matchMaps,
  matchRosters,
  matches,
  matchTimeProposals,
  postEventAdjudications,
  recruitmentInterests,
  recruitmentIntents,
  seasonRegistrations,
  seasons,
  teams,
  tournamentHonors,
  users,
} from "@/db/schema";
import { getDisplayName } from "@/lib/identity/display-name";
import { getAuditTargetFallbackLabel, getAuditTargetTypeLabel } from "@/lib/audit/presentation";

// Server-only owner. Keep this module out of Client Component import graphs.
export type AuditDatabaseExecutor = typeof db | TxDb;

export interface AuditTargetRef {
  targetType: string | null | undefined;
  targetId: string | null | undefined;
}

export interface AuditTargetPresentation {
  typeLabel: string;
  label: string;
  found: boolean;
}

export function auditTargetKey(targetType: string, targetId: string): string {
  return `${targetType}:${targetId}`;
}

/** Group and de-duplicate IDs before any database access. */
export function groupAuditTargets(refs: readonly AuditTargetRef[]): Map<string, string[]> {
  const grouped = new Map<string, Set<string>>();
  for (const ref of refs) {
    const targetType = ref.targetType?.trim();
    const targetId = ref.targetId?.trim();
    if (!targetType || !targetId) continue;
    const ids = grouped.get(targetType) ?? new Set<string>();
    ids.add(targetId);
    grouped.set(targetType, ids);
  }
  return new Map([...grouped].map(([type, ids]) => [type, [...ids]]));
}

type AuditUserRow = {
  id: string;
  email: string;
  steamName: string | null;
  displayName: string | null;
  perfectName: string | null;
};

async function selectUsers(executor: AuditDatabaseExecutor, ids: readonly string[]): Promise<AuditUserRow[]> {
  if (ids.length === 0) return [];
  return executor.select({
    id: users.id,
    email: users.email,
    steamName: users.steamName,
    displayName: users.displayName,
    perfectName: users.perfectName,
  }).from(users).where(inArray(users.id, ids));
}

async function selectEntries(executor: AuditDatabaseExecutor, ids: readonly string[]): Promise<Array<{ id: string; name: string }>> {
  if (ids.length === 0) return [];
  return executor.select({ id: competitionEntries.id, name: competitionEntries.name })
    .from(competitionEntries).where(inArray(competitionEntries.id, ids));
}

async function selectSeasons(executor: AuditDatabaseExecutor, ids: readonly string[]): Promise<Array<{ id: string; name: string }>> {
  if (ids.length === 0) return [];
  return executor.select({ id: seasons.id, name: seasons.name })
    .from(seasons).where(inArray(seasons.id, ids));
}

function compactLabel(value: string, maxLength = 72): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact;
}

const ADJUDICATION_KIND_LABELS: Readonly<Record<string, string>> = {
  team_sanction: "队伍纪律",
  result_statement: "比赛结果",
  placement_statement: "赛事名次",
  honor_directive: "赛事荣誉",
};

function setTarget(
  result: Record<string, AuditTargetPresentation>,
  targetType: string,
  targetId: string,
  label: string,
): void {
  result[auditTargetKey(targetType, targetId)] = {
    typeLabel: getAuditTargetTypeLabel(targetType),
    label,
    found: true,
  };
}

async function resolveMatchLabels(
  executor: AuditDatabaseExecutor,
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await executor.select({
    id: matches.id,
    entryAId: matches.entryAId,
    entryBId: matches.entryBId,
  }).from(matches).where(inArray(matches.id, ids));
  const entryIds = [...new Set(rows.flatMap((row) => [row.entryAId, row.entryBId]))];
  const entryRows = await selectEntries(executor, entryIds);
  const entryNames = new Map(entryRows.map((row) => [row.id, row.name]));
  return new Map(rows.map((row) => [
    row.id,
    `${entryNames.get(row.entryAId) ?? "未知队伍"} vs ${entryNames.get(row.entryBId) ?? "未知队伍"}`,
  ]));
}

export async function resolveAuditTargets(
  refs: readonly AuditTargetRef[],
  executor: AuditDatabaseExecutor = db,
): Promise<Record<string, AuditTargetPresentation>> {
  const grouped = groupAuditTargets(refs);
  const result: Record<string, AuditTargetPresentation> = {};

  // Seed the result with a human-readable category and a weak short-ID
  // fallback. A deleted target therefore never becomes raw type:uuid text.
  for (const [targetType, ids] of grouped) {
    for (const targetId of ids) {
      result[auditTargetKey(targetType, targetId)] = {
        typeLabel: getAuditTargetTypeLabel(targetType),
        label: getAuditTargetFallbackLabel(targetId),
        found: false,
      };
    }
  }

  const userIds = grouped.get("user") ?? [];
  if (userIds.length) {
    const rows = await selectUsers(executor, userIds);
    for (const row of rows) setTarget(result, "user", row.id, getDisplayName(row));
  }

  const seasonIds = grouped.get("season") ?? [];
  if (seasonIds.length) {
    const rows = await selectSeasons(executor, seasonIds);
    for (const row of rows) setTarget(result, "season", row.id, row.name);
  }

  const teamIds = grouped.get("team") ?? [];
  if (teamIds.length) {
    const rows = await executor.select({ id: teams.id, name: teams.name })
      .from(teams).where(inArray(teams.id, teamIds));
    for (const row of rows) setTarget(result, "team", row.id, row.name);
  }

  const entryTypes = ["competition_entry", "team_application"];
  const entryIds = [...new Set(entryTypes.flatMap((type) => grouped.get(type) ?? []))];
  if (entryIds.length) {
    const rows = await selectEntries(executor, entryIds);
    for (const row of rows) {
      for (const type of entryTypes) {
        if ((grouped.get(type) ?? []).includes(row.id)) setTarget(result, type, row.id, row.name);
      }
    }
  }

  const registrationIds = [...new Set([
    ...(grouped.get("registration") ?? []),
    ...(grouped.get("captain_vote") ?? []),
  ])];
  if (registrationIds.length) {
    const rows = await executor.select({ id: seasonRegistrations.id, userId: seasonRegistrations.userId })
      .from(seasonRegistrations).where(inArray(seasonRegistrations.id, registrationIds));
    const ownerRows = await selectUsers(executor, [...new Set(rows.map((row) => row.userId))]);
    const owners = new Map(ownerRows.map((row) => [row.id, getDisplayName(row)]));
    for (const row of rows) {
      if ((grouped.get("registration") ?? []).includes(row.id)) {
        setTarget(result, "registration", row.id, `报名 · ${owners.get(row.userId) ?? "未知用户"}`);
      }
      if ((grouped.get("captain_vote") ?? []).includes(row.id)) {
        setTarget(result, "captain_vote", row.id, `候选人 · ${owners.get(row.userId) ?? "未知用户"}`);
      }
    }
  }

  const matchIds = grouped.get("match") ?? [];
  if (matchIds.length) {
    const labels = await resolveMatchLabels(executor, matchIds);
    for (const [id, label] of labels) setTarget(result, "match", id, label);
  }

  const mapIds = grouped.get("match_map") ?? [];
  if (mapIds.length) {
    const rows = await executor.select({ id: matchMaps.id, matchId: matchMaps.matchId, mapName: matchMaps.mapName, mapOrder: matchMaps.mapOrder })
      .from(matchMaps).where(inArray(matchMaps.id, mapIds));
    const labels = await resolveMatchLabels(executor, [...new Set(rows.map((row) => row.matchId))]);
    for (const row of rows) {
      const order = Number.isFinite(row.mapOrder) ? `第 ${row.mapOrder} 图 · ` : "";
      setTarget(result, "match_map", row.id, `${order}${compactLabel(row.mapName)} · ${labels.get(row.matchId) ?? "比赛"}`);
    }
  }

  const rosterIds = grouped.get("match_roster") ?? [];
  if (rosterIds.length) {
    const rows = await executor.select({ id: matchRosters.id, matchId: matchRosters.matchId, entryId: matchRosters.entryId })
      .from(matchRosters).where(inArray(matchRosters.id, rosterIds));
    const entries = new Map((await selectEntries(executor, [...new Set(rows.map((row) => row.entryId))])).map((row) => [row.id, row.name]));
    for (const row of rows) setTarget(result, "match_roster", row.id, `阵容 · ${entries.get(row.entryId) ?? "未知队伍"}`);
  }

  const proposalIds = grouped.get("match_time_proposal") ?? [];
  if (proposalIds.length) {
    const rows = await executor.select({ id: matchTimeProposals.id, matchId: matchTimeProposals.matchId })
      .from(matchTimeProposals).where(inArray(matchTimeProposals.id, proposalIds));
    const labels = await resolveMatchLabels(executor, [...new Set(rows.map((row) => row.matchId))]);
    for (const row of rows) setTarget(result, "match_time_proposal", row.id, `时间提议 · ${labels.get(row.matchId) ?? "比赛"}`);
  }

  const draftStateIds = grouped.get("draft_state") ?? [];
  if (draftStateIds.length) {
    const rows = await executor.select({ id: draftState.id, seasonId: draftState.seasonId })
      .from(draftState).where(inArray(draftState.id, draftStateIds));
    const seasonNames = new Map((await selectSeasons(executor, [...new Set(rows.map((row) => row.seasonId))])).map((row) => [row.id, row.name]));
    for (const row of rows) setTarget(result, "draft_state", row.id, `选秀 · ${seasonNames.get(row.seasonId) ?? "未知赛季"}`);
  }

  const draftPickIds = grouped.get("draft_pick") ?? [];
  if (draftPickIds.length) {
    const rows = await executor.select({ id: draftPicks.id, entryId: draftPicks.entryId, registrationId: draftPicks.registrationId })
      .from(draftPicks).where(inArray(draftPicks.id, draftPickIds));
    const entries = new Map((await selectEntries(executor, [...new Set(rows.map((row) => row.entryId))])).map((row) => [row.id, row.name]));
    const registrations = await executor.select({ id: seasonRegistrations.id, userId: seasonRegistrations.userId })
      .from(seasonRegistrations).where(inArray(seasonRegistrations.id, [...new Set(rows.map((row) => row.registrationId))]));
    const owners = new Map((await selectUsers(executor, [...new Set(registrations.map((row) => row.userId))])).map((row) => [row.id, getDisplayName(row)]));
    const registrationOwners = new Map(registrations.map((row) => [row.id, owners.get(row.userId) ?? "未知用户"]));
    for (const row of rows) setTarget(result, "draft_pick", row.id, `${registrationOwners.get(row.registrationId) ?? "未知用户"} → ${entries.get(row.entryId) ?? "未知队伍"}`);
  }

  const educationIds = grouped.get("education_verification") ?? [];
  if (educationIds.length) {
    const rows = await executor.select({ id: educationVerifications.id, userId: educationVerifications.userId, institutionId: educationVerifications.institutionId })
      .from(educationVerifications).where(inArray(educationVerifications.id, educationIds));
    const ownerNames = new Map((await selectUsers(executor, [...new Set(rows.map((row) => row.userId))])).map((row) => [row.id, getDisplayName(row)]));
    const institutionNames = new Map((await executor.select({ id: institutions.id, name: institutions.name }).from(institutions).where(inArray(institutions.id, [...new Set(rows.map((row) => row.institutionId))]))).map((row) => [row.id, row.name]));
    for (const row of rows) {
      setTarget(result, "education_verification", row.id, `认证 · ${ownerNames.get(row.userId) ?? "未知用户"} · ${institutionNames.get(row.institutionId) ?? "未知院校"}`);
    }
  }

  const platformIds = grouped.get("competitive_platform") ?? [];
  if (platformIds.length) {
    const rows = await executor.select({ key: competitivePlatforms.key, displayName: competitivePlatforms.displayName })
      .from(competitivePlatforms).where(inArray(competitivePlatforms.key, platformIds));
    for (const row of rows) setTarget(result, "competitive_platform", row.key, row.displayName);
  }

  const rankIds = grouped.get("competitive_platform_rank") ?? [];
  if (rankIds.length) {
    const rows = await executor.select({ id: competitivePlatformRanks.id, platformKey: competitivePlatformRanks.platformKey, label: competitivePlatformRanks.label })
      .from(competitivePlatformRanks).where(inArray(competitivePlatformRanks.id, rankIds));
    const platformNames = new Map((await executor.select({ key: competitivePlatforms.key, displayName: competitivePlatforms.displayName }).from(competitivePlatforms).where(inArray(competitivePlatforms.key, [...new Set(rows.map((row) => row.platformKey))]))).map((row) => [row.key, row.displayName]));
    for (const row of rows) setTarget(result, "competitive_platform_rank", row.id, `${platformNames.get(row.platformKey) ?? "竞技平台"} · ${row.label}`);
  }

  const platformSeasonIds = grouped.get("competitive_platform_season") ?? [];
  if (platformSeasonIds.length) {
    const rows = await executor.select({ id: competitivePlatformSeasons.id, platform: competitivePlatformSeasons.platform, label: competitivePlatformSeasons.label })
      .from(competitivePlatformSeasons).where(inArray(competitivePlatformSeasons.id, platformSeasonIds));
    const platformNames = new Map((await executor.select({ key: competitivePlatforms.key, displayName: competitivePlatforms.displayName }).from(competitivePlatforms).where(inArray(competitivePlatforms.key, [...new Set(rows.map((row) => row.platform))]))).map((row) => [row.key, row.displayName]));
    for (const row of rows) setTarget(result, "competitive_platform_season", row.id, `${platformNames.get(row.platform) ?? "竞技平台"} · ${row.label}`);
  }

  const disciplineIds = grouped.get("disciplinary_case") ?? [];
  if (disciplineIds.length) {
    const rows = await executor.select({ id: disciplinaryCases.id, subjectUserId: disciplinaryCases.subjectUserId })
      .from(disciplinaryCases).where(inArray(disciplinaryCases.id, disciplineIds));
    const names = new Map((await selectUsers(executor, [...new Set(rows.map((row) => row.subjectUserId))])).map((row) => [row.id, getDisplayName(row)]));
    for (const row of rows) setTarget(result, "disciplinary_case", row.id, `处罚对象 · ${names.get(row.subjectUserId) ?? "未知用户"}`);
  }

  const inviteIds = grouped.get("admin_invite") ?? [];
  if (inviteIds.length) {
    const rows = await executor.select({ id: adminInvites.id, role: adminInvites.role })
      .from(adminInvites).where(inArray(adminInvites.id, inviteIds));
    for (const row of rows) setTarget(result, "admin_invite", row.id, row.role === "super_admin" ? "全局管理员邀请" : "赛季管理员邀请");
  }

  const awardIds = grouped.get("community_award") ?? [];
  if (awardIds.length) {
    const rows = await executor.select({ id: communityAwards.id, name: communityAwards.name })
      .from(communityAwards).where(inArray(communityAwards.id, awardIds));
    for (const row of rows) setTarget(result, "community_award", row.id, `社区奖 · ${compactLabel(row.name)}`);
  }

  const evidenceIds = grouped.get("community_award_evidence") ?? [];
  if (evidenceIds.length) {
    const rows = await executor.select({ id: communityAwardEvidence.id, awardId: communityAwardEvidence.awardId })
      .from(communityAwardEvidence).where(inArray(communityAwardEvidence.id, evidenceIds));
    const awards = new Map((await executor.select({ id: communityAwards.id, name: communityAwards.name }).from(communityAwards).where(inArray(communityAwards.id, [...new Set(rows.map((row) => row.awardId))]))).map((row) => [row.id, row.name]));
    for (const row of rows) setTarget(result, "community_award_evidence", row.id, `社区奖证据 · ${compactLabel(awards.get(row.awardId) ?? "未知奖项")}`);
  }

  const majorStateIds = grouped.get("major_prestart_state") ?? [];
  if (majorStateIds.length) {
    const rows = await executor.select({ id: majorPrestartStates.id, seasonId: majorPrestartStates.seasonId })
      .from(majorPrestartStates).where(inArray(majorPrestartStates.id, majorStateIds));
    const seasonNames = new Map((await selectSeasons(executor, [...new Set(rows.map((row) => row.seasonId))])).map((row) => [row.id, row.name]));
    for (const row of rows) setTarget(result, "major_prestart_state", row.id, `Major 赛前 · ${seasonNames.get(row.seasonId) ?? "未知赛季"}`);
  }

  const entrantTypes = ["major_tournament_entrant", "major_prestart_entrant"];
  const entrantIds = [...new Set(entrantTypes.flatMap((type) => grouped.get(type) ?? []))];
  if (entrantIds.length) {
    const rows = await executor.select({ id: majorTournamentEntrants.id, competitionEntryId: majorTournamentEntrants.competitionEntryId })
      .from(majorTournamentEntrants).where(inArray(majorTournamentEntrants.id, entrantIds));
    const entries = new Map((await selectEntries(executor, [...new Set(rows.map((row) => row.competitionEntryId))])).map((row) => [row.id, row.name]));
    for (const row of rows) {
      for (const type of entrantTypes) {
        if ((grouped.get(type) ?? []).includes(row.id)) setTarget(result, type, row.id, `Major 参赛队 · ${entries.get(row.competitionEntryId) ?? "未知队伍"}`);
      }
    }
  }

  const issueIds = grouped.get("major_prestart_issue") ?? [];
  if (issueIds.length) {
    const rows = await executor.select({ id: majorPrestartIssues.id, label: majorPrestartIssues.label })
      .from(majorPrestartIssues).where(inArray(majorPrestartIssues.id, issueIds));
    for (const row of rows) setTarget(result, "major_prestart_issue", row.id, `Major 赛前问题 · ${compactLabel(row.label)}`);
  }

  const stageRunIds = grouped.get("major_stage_run") ?? [];
  if (stageRunIds.length) {
    const rows = await executor.select({ id: majorStageRuns.id, seasonId: majorStageRuns.seasonId })
      .from(majorStageRuns).where(inArray(majorStageRuns.id, stageRunIds));
    const seasonNames = new Map((await selectSeasons(executor, [...new Set(rows.map((row) => row.seasonId))])).map((row) => [row.id, row.name]));
    for (const row of rows) setTarget(result, "major_stage_run", row.id, `Major 阶段 · ${seasonNames.get(row.seasonId) ?? "未知赛季"}`);
  }

  const finalResultIds = grouped.get("major_final_result") ?? [];
  if (finalResultIds.length) {
    const rows = await executor.select({ id: majorFinalResults.id, seasonId: majorFinalResults.seasonId, championEntryId: majorFinalResults.championEntryId })
      .from(majorFinalResults).where(inArray(majorFinalResults.id, finalResultIds));
    const seasonNames = new Map((await selectSeasons(executor, [...new Set(rows.map((row) => row.seasonId))])).map((row) => [row.id, row.name]));
    const entries = new Map((await selectEntries(executor, [...new Set(rows.map((row) => row.championEntryId))])).map((row) => [row.id, row.name]));
    for (const row of rows) setTarget(result, "major_final_result", row.id, `Major 最终赛果 · ${seasonNames.get(row.seasonId) ?? "未知赛季"} · 冠军 ${entries.get(row.championEntryId) ?? "未知队伍"}`);
  }

  const adjudicationIds = grouped.get("post_event_adjudication") ?? [];
  if (adjudicationIds.length) {
    const rows = await executor.select({ id: postEventAdjudications.id, seasonId: postEventAdjudications.seasonId, kind: postEventAdjudications.kind })
      .from(postEventAdjudications).where(inArray(postEventAdjudications.id, adjudicationIds));
    const seasonNames = new Map((await selectSeasons(executor, [...new Set(rows.map((row) => row.seasonId))])).map((row) => [row.id, row.name]));
    for (const row of rows) {
      const kindLabel = ADJUDICATION_KIND_LABELS[row.kind] ?? "赛后裁定";
      setTarget(result, "post_event_adjudication", row.id, `赛后裁定 · ${seasonNames.get(row.seasonId) ?? "未知赛季"} · ${kindLabel}`);
    }
  }

  const honorIds = grouped.get("tournament_honor") ?? [];
  if (honorIds.length) {
    const rows = await executor.select({ id: tournamentHonors.id, seasonId: tournamentHonors.seasonId, label: tournamentHonors.label, entryId: tournamentHonors.entryId, userId: tournamentHonors.userId })
      .from(tournamentHonors).where(inArray(tournamentHonors.id, honorIds));
    const seasonNames = new Map((await selectSeasons(executor, [...new Set(rows.map((row) => row.seasonId))])).map((row) => [row.id, row.name]));
    const entries = new Map((await selectEntries(executor, [...new Set(rows.flatMap((row) => row.entryId ? [row.entryId] : []))])).map((row) => [row.id, row.name]));
    const names = new Map((await selectUsers(executor, [...new Set(rows.flatMap((row) => row.userId ? [row.userId] : []))])).map((row) => [row.id, getDisplayName(row)]));
    for (const row of rows) {
      const recipient = row.entryId ? entries.get(row.entryId) : row.userId ? names.get(row.userId) : undefined;
      setTarget(result, "tournament_honor", row.id, `赛事荣誉 · ${compactLabel(row.label)}${recipient ? ` · ${recipient}` : ""} · ${seasonNames.get(row.seasonId) ?? "未知赛季"}`);
    }
  }

  const intentIds = grouped.get("recruitment_intent") ?? [];
  if (intentIds.length) {
    const rows = await executor.select({ id: recruitmentIntents.id, kind: recruitmentIntents.kind, teamId: recruitmentIntents.teamId, userId: recruitmentIntents.userId })
      .from(recruitmentIntents).where(inArray(recruitmentIntents.id, intentIds));
    const teamsById = new Map((await executor.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, [...new Set(rows.flatMap((row) => row.teamId ? [row.teamId] : []))]))).map((row) => [row.id, row.name]));
    const usersById = new Map((await selectUsers(executor, [...new Set(rows.flatMap((row) => row.userId ? [row.userId] : []))])).map((row) => [row.id, getDisplayName(row)]));
    for (const row of rows) {
      const owner = row.kind === "team_recruiting" ? teamsById.get(row.teamId ?? "") : usersById.get(row.userId ?? "");
      setTarget(result, "recruitment_intent", row.id, `招募意向 · ${owner ?? "未知用户"}`);
    }
  }

  const interestIds = grouped.get("recruitment_interest") ?? [];
  if (interestIds.length) {
    const rows = await executor.select({ id: recruitmentInterests.id, userId: recruitmentInterests.userId })
      .from(recruitmentInterests).where(inArray(recruitmentInterests.id, interestIds));
    const usersById = new Map((await selectUsers(executor, [...new Set(rows.map((row) => row.userId))])).map((row) => [row.id, getDisplayName(row)]));
    for (const row of rows) setTarget(result, "recruitment_interest", row.id, `申请人 · ${usersById.get(row.userId) ?? "未知用户"}`);
  }

  return result;
}
