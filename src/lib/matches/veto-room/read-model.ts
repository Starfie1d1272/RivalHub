import "server-only";

import { and, eq, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  competitionEntries,
  eventRosterMembers,
  matchRosterPlayers,
  matchRosters,
  seasons,
  steamProfiles,
  users,
} from "@/db/schema";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { getCurrentUserAuthorization, getUserSession } from "@/lib/auth/session";
import { normalizeRegistrationConfig, normalizeStagePlan } from "@/lib/seasons/compatibility";
import { mapLabel } from "@/lib/maps";
import { MATCH_FORMAT_LABELS, SIDE_LABELS } from "@/types/match";
import { readVetoRoomSnapshot, type VetoRoomCoreSnapshot } from "./service";

const MATCH_STATUS_LABELS = {
  scheduled: "待进行",
  in_progress: "进行中",
  finished: "已结束",
  cancelled: "已取消",
} as const;

const VETO_ACTION_LABELS = {
  role_select: "选择 VETO A",
  ban: "BAN",
  pick: "PICK",
  side_pick: "SIDE",
  decider: "DECIDER",
} as const;

const APPEAL_STATUS_LABELS = {
  pending: "待裁定",
  accepted: "已接受",
  rejected: "已驳回",
} as const;

function getEntryIdForViewer(
  viewerId: string | null,
  entries: readonly { id: string; representativeUserId: string }[],
  rosterPlayers: readonly { entryId: string; userId: string; isStarter: boolean }[],
): string | null {
  if (!viewerId) return null;
  const representative = entries.find((entry) => entry.representativeUserId === viewerId);
  if (representative) return representative.id;
  return rosterPlayers.find((player) => player.userId === viewerId && player.isStarter)?.entryId ?? null;
}

export async function getVetoRoomView(matchId: string) {
  const [core, viewer, authorization] = await Promise.all([
    readVetoRoomSnapshot(matchId),
    getUserSession(),
    getCurrentUserAuthorization(),
  ]);
  return projectVetoRoomView(core, viewer?.userId ?? null, authorization);
}

export async function projectVetoRoomView(
  core: VetoRoomCoreSnapshot,
  viewerId: string | null,
  authorization: Awaited<ReturnType<typeof getCurrentUserAuthorization>>,
 ) {
  const [context] = await db
    .select({
      seasonSlug: seasons.slug,
      seasonName: seasons.name,
      stagePlan: seasons.stagePlan,
      registrationConfig: seasons.registrationConfig,
    })
    .from(seasons)
    .where(eq(seasons.id, core.match.seasonId))
    .limit(1);
  if (!context) throw new Error("赛事不存在。");

  const entryRows = await db
    .select({ id: competitionEntries.id, name: competitionEntries.name, representativeUserId: competitionEntries.representativeUserId })
    .from(competitionEntries)
    .where(and(
      eq(competitionEntries.competitionId, core.match.seasonId),
      orEntryId(core.match.entryAId, core.match.entryBId),
    ));
  const entryById = new Map(entryRows.map((entry) => [entry.id, entry]));

  const rosterRows = await db
    .select({
      entryId: matchRosters.entryId,
      rosterId: matchRosters.id,
      rosterStatus: matchRosters.status,
      memberId: eventRosterMembers.id,
      userId: eventRosterMembers.userId,
      displayName: users.displayName,
      perfectName: users.perfectName,
      personaName: steamProfiles.personaName,
      isStarter: matchRosterPlayers.isStarter,
      isVetoRepresentative: matchRosterPlayers.isVetoRepresentative,
    })
    .from(matchRosters)
    .innerJoin(matchRosterPlayers, eq(matchRosterPlayers.rosterId, matchRosters.id))
    .innerJoin(eventRosterMembers, eq(eventRosterMembers.id, matchRosterPlayers.eventRosterMemberId))
    .innerJoin(users, eq(users.id, eventRosterMembers.userId))
    .leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64))
    .where(eq(matchRosters.matchId, core.match.id));

  const clockResult = await db.execute(sql`SELECT clock_timestamp() AS now`);
  const clockRow = clockResult.rows[0] as { now?: Date | string } | undefined;
  if (!clockRow?.now) throw new Error("读取 BP 房间服务器时间失败。");
  const serverNow = clockRow.now instanceof Date ? clockRow.now : new Date(clockRow.now);

  const rosterByEntry = new Map<string, typeof rosterRows>();
  for (const row of rosterRows) {
    const rows = rosterByEntry.get(row.entryId) ?? [];
    rows.push(row);
    rosterByEntry.set(row.entryId, rows);
  }
  const isAdmin = authorization?.role === "super_admin" || Boolean(authorization?.seasonIds.includes(core.match.seasonId));
  const viewerEntryId = getEntryIdForViewer(viewerId, entryRows, rosterRows);
  const currentTurnEntry = core.currentTurn?.actorEntryId ?? null;
  const mapPool = core.session.mapPoolSnapshot
    ?? normalizeRegistrationConfig(context.registrationConfig).mapPool;

  const entries = [core.match.entryAId, core.match.entryBId].map((entryId) => {
    const entry = entryById.get(entryId);
    const rows = rosterByEntry.get(entryId) ?? [];
    const bpRepresentative = rows.find((row) => row.isVetoRepresentative && row.isStarter) ?? null;
    const lineupConfirmed = rows.length > 0;
    const currentViewerStarter = rows.some((row) => row.userId === viewerId && row.isStarter);
    const isViewerEntryRepresentative = entry?.representativeUserId === viewerId;
    const mayEditRepresentative = Boolean(
      (!core.session.startedAt && core.match.status === "scheduled" && (isAdmin || isViewerEntryRepresentative)) ||
      (core.session.startedAt && core.match.status === "in_progress" && isAdmin),
    );
    const mayRequestStart = Boolean(
      core.match.status === "scheduled" && !core.session.startedAt && core.session.privilegedEntryId &&
      (!core.match.scheduledAt || serverNow >= new Date(core.match.scheduledAt.getTime() - 15 * 60_000)) && viewerId && (
        bpRepresentative?.userId === viewerId ||
        (isViewerEntryRepresentative && core.effectiveForceAt && serverNow >= core.effectiveForceAt)
      ),
    ) && lineupConfirmed;
    return {
      id: entryId,
      name: entry?.name ?? "未知队伍",
      vetoRoleLabel: core.session.vetoTeamAEntryId === entryId ? "VETO A" : core.session.vetoTeamAEntryId && core.session.vetoTeamAEntryId !== entryId ? "VETO B" : null,
      rosterConfirmed: rows.length > 0,
      rosterStatusLabel: rows[0]?.rosterStatus === "confirmed" ? "首发已定格" : rows.length > 0 ? "本场首发已就绪" : "尚未提交首发",
      lineupBlocker: rows.length === 0
        ? "尚未提交本场首发"
        : rows.length === 0 ? "本场首发尚未就绪" : null,
      starters: rows.filter((row) => row.isStarter).map((row) => ({
        id: row.memberId,
        name: getPublicDisplayName(row),
        isVetoRepresentative: row.isVetoRepresentative,
        isViewer: row.userId === viewerId,
      })),
      vetoRepresentativeMemberId: bpRepresentative?.memberId ?? null,
      vetoRepresentativeName: bpRepresentative ? getPublicDisplayName(bpRepresentative) : null,
      startRequested: entryId === core.match.entryAId
        ? core.session.entryAStartRequestedAt !== null
        : core.session.entryBStartRequestedAt !== null,
      isViewerEntryRepresentative,
      isViewerVetoRepresentative: bpRepresentative?.userId === viewerId,
      mayEditRepresentative,
      mayReassignRepresentative: Boolean(isAdmin && core.session.startedAt),
      mayClaimRepresentative: Boolean(core.match.status === "scheduled" && currentViewerStarter && !bpRepresentative && !core.session.startedAt),
      mayRequestStart,
      mayChooseVetoRole: Boolean(core.match.status === "in_progress" && currentTurnEntry === entryId && bpRepresentative?.userId === viewerId),
    };
  });
  const stepEntries = core.steps.map((step) => {
    const actionType = (step.actionType in VETO_ACTION_LABELS ? step.actionType : "decider") as keyof typeof VETO_ACTION_LABELS;
    const entryName = step.entryId ? entryById.get(step.entryId)?.name ?? "未知队伍" : null;
    const sourceLabel = step.source === "timeout" ? "AUTO" : step.source === "system" ? "SYSTEM" : step.source === null ? "历史记录" : "人工";
    const description = actionType === "side_pick"
      ? `${entryName ?? "队伍"} 为 ${mapLabel(step.mapName)} 选择起始方`
      : actionType === "decider"
        ? `${mapLabel(step.mapName)} 成为决胜图`
        : `${entryName ?? "队伍"} ${VETO_ACTION_LABELS[actionType]} ${mapLabel(step.mapName)}`;
    return {
      id: step.id,
      stepOrder: step.stepOrder,
      turnKey: step.turnKey,
      actionLabel: VETO_ACTION_LABELS[actionType],
      mapName: step.mapName,
      mapLabel: mapLabel(step.mapName),
      entryName,
      sideLabel: step.side ? SIDE_LABELS[step.side] : null,
      sourceLabel,
      description,
    };
  });

  const appealsByIncident = new Map(core.appeals.map((appeal) => [appeal.timeoutIncidentId, appeal]));
  const incidents = core.incidents.map((incident) => {
    const appeal = appealsByIncident.get(incident.id);
    const canSeeReason = Boolean(isAdmin || appeal?.submittedBy === viewerId);
    const entryRepresentativeId = incident.entryId ? entryById.get(incident.entryId)?.representativeUserId : null;
    const selected = incident.selectedOptions.map((option) => entryById.get(option)?.name ?? (option === "ct" ? "CT 方" : option === "t" ? "T 方" : mapLabel(option)));
    return {
      id: incident.id,
      entryName: incident.entryId ? entryById.get(incident.entryId)?.name ?? "未知队伍" : "系统",
      selected,
      sourceLabel: "AUTO",
      appeal: appeal ? {
        id: appeal.id,
        statusLabel: APPEAL_STATUS_LABELS[appeal.status],
        reason: canSeeReason ? appeal.reason : null,
        resolutionNote: canSeeReason ? appeal.resolutionNote : null,
        mayResolve: isAdmin && appeal.status === "pending",
      } : null,
      mayAppeal: Boolean(viewerId && !appeal && (
        incident.representativeUserId === viewerId || entryRepresentativeId === viewerId
      )),
    };
  });

  const map = (value: string) => mapLabel(value);
  return {
    seasonSlug: context.seasonSlug,
    seasonName: context.seasonName,
    match: {
      id: core.match.id,
      stage: core.match.stage === "play-in"
        ? "PLAY-IN"
        : normalizeStagePlan(context.stagePlan).find((stage) => stage.key === core.match.stage)?.name ?? "赛事阶段",
      round: core.match.round,
      format: MATCH_FORMAT_LABELS[core.match.format],
      formatKey: core.match.format,
      statusKey: core.match.status,
      statusLabel: MATCH_STATUS_LABELS[core.match.status],
      scheduledAt: core.match.scheduledAt?.toISOString() ?? null,
      entryAId: core.match.entryAId,
      entryBId: core.match.entryBId,
    },
    entries,
    session: {
      revision: core.session.revision,
      currentTurnKey: core.currentTurn?.key ?? null,
      currentTurnAction: core.currentTurn ? core.currentTurn.actionType : null,
      currentTurnLabel: core.currentTurn ? VETO_ACTION_LABELS[core.currentTurn.actionType] : null,
      currentTurnEntryName: currentTurnEntry ? entryById.get(currentTurnEntry)?.name ?? "未知队伍" : null,
      currentTurnMapName: core.currentTurn?.mapName ?? null,
      currentTurnMapLabel: core.currentTurn?.mapName ? map(core.currentTurn.mapName) : null,
      currentTurnCompleted: core.currentTurn?.completed ?? 0,
      currentTurnCount: core.currentTurn?.count ?? 0,
      currentTurnDurationSeconds: core.currentTurn?.durationSeconds ?? null,
      turnStartedAt: core.session.turnStartedAt?.toISOString() ?? null,
      turnDeadlineAt: core.session.turnDeadlineAt?.toISOString() ?? null,
      serverNow: serverNow.toISOString(),
      startedAt: core.session.startedAt?.toISOString() ?? null,
      completedAt: core.session.completedAt?.toISOString() ?? null,
      paused: core.session.pausedAt !== null,
      currentTurnEntryId: core.currentTurn?.actorEntryId ?? null,
      pauseReason: isAdmin ? core.session.pauseReason : null,
      mapPool: mapPool.map((name) => ({ name, label: map(name) })),
      privilegedEntryName: core.session.privilegedEntryId ? entryById.get(core.session.privilegedEntryId)?.name ?? null : null,
      privilegedEntryId: core.session.privilegedEntryId,
      manualPrivilegedSelectionRequired: !core.match.majorStageRunId && !core.match.qualificationRunId && core.session.privilegedEntryId === null,
      effectiveForceAt: core.effectiveForceAt?.toISOString() ?? null,
      previousMatchBlocker: core.previousMatchBlocker,
      startWindowOpen: core.match.scheduledAt === null || serverNow >= new Date(core.match.scheduledAt.getTime() - 15 * 60_000),
    },
    steps: stepEntries,
    incidents,
    permissions: {
      isAdmin,
      viewerEntryId,
      canOperateCurrentTurn: Boolean(core.match.status === "in_progress" && viewerId && currentTurnEntry && entries.some((entry) => entry.id === currentTurnEntry && entry.isViewerVetoRepresentative)),
      canPause: Boolean(isAdmin && core.session.startedAt && !core.session.completedAt && !core.session.pausedAt),
      canResume: Boolean(isAdmin && core.session.pausedAt),
      canRewind: Boolean(isAdmin && core.session.startedAt && core.match.status === "in_progress"),
      canSetManualPrivilegedEntry: Boolean(isAdmin && core.match.status === "scheduled" && !core.session.startedAt && !core.match.majorStageRunId && !core.match.qualificationRunId),
    },
  };
}

export type VetoRoomView = Awaited<ReturnType<typeof getVetoRoomView>>;

function orEntryId(entryAId: string, entryBId: string) {
  return or(eq(competitionEntries.id, entryAId), eq(competitionEntries.id, entryBId));
}
