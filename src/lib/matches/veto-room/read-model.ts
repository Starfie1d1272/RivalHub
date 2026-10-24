import "server-only";

import { and, eq, inArray, or, sql, type Column, type GetColumnData } from "drizzle-orm";
import { db, type DB } from "@/db/client";
import {
  competitionEntries,
  eventRosterMembers,
  matchRosterPlayers,
  matchMaps,
  matchRosters,
  seasons,
  steamProfiles,
  users,
} from "@/db/schema";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { getCurrentUserAuthorization } from "@/lib/auth/session";
import { AppError, ErrorCode } from "@/lib/errors";
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

import { VETO_ACTION_LABELS } from "@/lib/matches/veto-presentation";

const APPEAL_STATUS_LABELS = {
  pending: "待裁定",
  accepted: "已接受",
  rejected: "已驳回",
  closed: "已结束（正式对局已开始）",
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

/** An explicit authorization value is valid only within the current request. */
export async function getVetoRoomView(matchId: string, requestAuthorization?: Awaited<ReturnType<typeof getCurrentUserAuthorization>>, expectedSeasonId?: string) {
  const [core, authorization] = await Promise.all([
    readVetoRoomSnapshot(matchId),
    requestAuthorization === undefined ? getCurrentUserAuthorization() : Promise.resolve(requestAuthorization),
  ]);
  if (expectedSeasonId !== undefined && core.match.seasonId !== expectedSeasonId) throw new AppError(ErrorCode.MATCH_NOT_FOUND, "比赛不存在。");
  return projectVetoRoomView(core, authorization?.userId ?? null, authorization);
}

// json_agg reads SQL column labels, so preserve the DTO's camelCase field names.
function jsonField<T extends Column>(column: T, name: string) {
  return sql<GetColumnData<T>>`${column}`.as(name);
}

export async function projectVetoRoomView(
  core: VetoRoomCoreSnapshot,
  viewerId: string | null,
  authorization: Awaited<ReturnType<typeof getCurrentUserAuthorization>>,
  database: Pick<DB, "select"> = db,
) {
  const entriesQuery = database
      .select({ id: jsonField(competitionEntries.id, "id"), name: jsonField(competitionEntries.name, "name"), representativeUserId: jsonField(competitionEntries.representativeUserId, "representativeUserId") })
      .from(competitionEntries)
      .where(and(
        eq(competitionEntries.competitionId, core.match.seasonId),
        orEntryId(core.match.entryAId, core.match.entryBId),
      ));
  const rosterQuery = database
      .select({
        entryId: jsonField(matchRosters.entryId, "entryId"),
        rosterId: jsonField(matchRosters.id, "rosterId"),
        rosterStatus: jsonField(matchRosters.status, "rosterStatus"),
        memberId: jsonField(eventRosterMembers.id, "memberId"),
        userId: jsonField(eventRosterMembers.userId, "userId"),
        displayName: jsonField(users.displayName, "displayName"),
        perfectName: jsonField(users.perfectName, "perfectName"),
        personaName: jsonField(steamProfiles.personaName, "personaName"),
        isStarter: jsonField(matchRosterPlayers.isStarter, "isStarter"),
        isVetoRepresentative: jsonField(matchRosterPlayers.isVetoRepresentative, "isVetoRepresentative"),
      })
      .from(matchRosters)
      .innerJoin(matchRosterPlayers, eq(matchRosterPlayers.rosterId, matchRosters.id))
      .innerJoin(eventRosterMembers, eq(eventRosterMembers.id, matchRosterPlayers.eventRosterMemberId))
      .innerJoin(users, eq(users.id, eventRosterMembers.userId))
      .leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64))
      .where(eq(matchRosters.matchId, core.match.id));
  const operatorsQuery = database.select({ userId: jsonField(users.id, "userId"), displayName: jsonField(users.displayName, "displayName"), perfectName: jsonField(users.perfectName, "perfectName"), personaName: jsonField(steamProfiles.personaName, "personaName") })
      .from(users).leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64))
      .where(core.match.testConfig ? inArray(users.id, [core.match.testConfig.operatorAId, core.match.testConfig.operatorBId]) : sql`false`);
  const mapsQuery = database.select({
      id: jsonField(matchMaps.id, "id"), mapOrder: jsonField(matchMaps.mapOrder, "mapOrder"), mapName: jsonField(matchMaps.mapName, "mapName"), teamAStartSide: jsonField(matchMaps.teamAStartSide, "teamAStartSide"),
    }).from(matchMaps).where(eq(matchMaps.matchId, core.match.id));
  // Bounded public rows share one SQL round trip; auth finishes before this response clock.
  const [context] = await database.select({
    entryRows: sql<Awaited<typeof entriesQuery>>`coalesce((select json_agg(veto_entries) from (${entriesQuery}) veto_entries), '[]'::json)`,
    rosterRows: sql<Awaited<typeof rosterQuery>>`coalesce((select json_agg(veto_roster) from (${rosterQuery}) veto_roster), '[]'::json)`,
    operatorRows: core.match.testConfig ? sql<Awaited<typeof operatorsQuery>>`coalesce((select json_agg(veto_operators) from (${operatorsQuery}) veto_operators), '[]'::json)` : sql<Awaited<typeof operatorsQuery>>`'[]'::json`,
    completedMaps: core.session.completedAt ? sql<Awaited<typeof mapsQuery>>`coalesce((select json_agg(veto_maps) from (${mapsQuery}) veto_maps), '[]'::json)` : sql<Awaited<typeof mapsQuery>>`'[]'::json`,
    seasonSlug: seasons.slug,
    seasonName: seasons.name,
    stagePlan: seasons.stagePlan,
    registrationConfig: seasons.registrationConfig,
    serverNow: sql<string>`clock_timestamp()`.mapWith(value => new Date(value)),
  }).from(seasons).where(eq(seasons.id, core.match.seasonId)).limit(1);
  if (!context) throw new Error("赛事不存在。");
  const { entryRows, rosterRows, operatorRows, completedMaps } = context;
  const entryById = new Map(entryRows.map((entry) => [entry.id, entry]));
  const serverNow = context.serverNow;

  const rosterByEntry = new Map<string, typeof rosterRows>();
  for (const row of rosterRows) {
    const rows = rosterByEntry.get(row.entryId) ?? [];
    rows.push(row);
    rosterByEntry.set(row.entryId, rows);
  }
  const isAdmin = authorization?.role === "super_admin" || Boolean(authorization?.seasonIds.includes(core.match.seasonId));
  const viewerEntryId = core.match.testConfig?.operatorAId === viewerId ? core.match.entryAId : core.match.testConfig?.operatorBId === viewerId ? core.match.entryBId : getEntryIdForViewer(viewerId, entryRows, rosterRows);
  const currentTurnEntry = core.currentTurn?.actorEntryId ?? null;
  const mapPool = core.session.mapPoolSnapshot
    ?? core.match.testConfig?.mapPool ?? normalizeRegistrationConfig(context.registrationConfig).mapPool;

  const entries = [core.match.entryAId, core.match.entryBId].map((entryId) => {
    const entry = entryById.get(entryId);
    const rows = rosterByEntry.get(entryId) ?? [];
    const configuredOperatorId = core.match.testConfig ? (entryId === core.match.entryAId ? core.match.testConfig.operatorAId : core.match.testConfig.operatorBId) : null;
    const operator = operatorRows.find(row => row.userId === configuredOperatorId);
    const bpRepresentative = core.match.testConfig ? (operator ? { ...operator, memberId: rows.find(row => row.userId === operator.userId)?.memberId ?? null } : null) : rows.find((row) => row.isVetoRepresentative && row.isStarter) ?? null;
    const starterCount = rows.filter(row => row.isStarter).length;
    const lineupConfirmed = starterCount === 5;
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
      vetoRoleLabel: core.session.vetoTeamAEntryId === entryId ? "先禁图方" : core.session.vetoTeamAEntryId && core.session.vetoTeamAEntryId !== entryId ? "后禁图方" : null,
      rosterConfirmed: lineupConfirmed,
      rosterStatusLabel: lineupConfirmed ? rows[0]?.rosterStatus === "confirmed" ? "首发已确认" : "首发已提交" : "首发待准备",
      lineupBlocker: rows.length === 0 ? "请提交本场首发" : starterCount !== 5 ? `请补齐 5 名首发（当前 ${starterCount} 人）` : null,
      starters: rows.filter((row) => row.isStarter).map((row) => ({
        id: row.memberId,
        userId: row.userId,
        name: getPublicDisplayName(row),
        isVetoRepresentative: row.isVetoRepresentative,
        isViewer: row.userId === viewerId,
      })),
      vetoRepresentativeUserId: bpRepresentative?.userId ?? null,
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
    const sourceLabel = step.source === "timeout" ? "超时自动选择" : step.source === "admin" ? "管理员调整" : null;
    const actionDescription = actionType === "side_pick"
      ? `chose ${step.side?.toUpperCase() ?? "—"} on ${mapLabel(step.mapName)}`
      : actionType === "decider"
        ? `${mapLabel(step.mapName)} was left over`
        : `${actionType === "ban" ? "removed" : "picked"} ${mapLabel(step.mapName)}`;
    const description = actionType === "decider" ? actionDescription : `${entryName ?? "队伍"} ${actionDescription}`;
    return {
      id: step.id,
      stepOrder: step.stepOrder,
      turnKey: step.turnKey,
      actionLabel: VETO_ACTION_LABELS[actionType],
      mapName: step.mapName,
      mapLabel: mapLabel(step.mapName),
      entryId: step.entryId,
      actionType,
      entryName,
      actionDescription,
      sideLabel: step.side ? SIDE_LABELS[step.side] : null,
      sourceLabel,
      description,
    };
  });

  const gameplayStarted = core.gameplayStarted;
  const recoveryClosed = core.match.status === "finished" || core.match.status === "cancelled" || gameplayStarted;
  const appealsByIncident = new Map(core.appeals.map((appeal) => [appeal.timeoutIncidentId, appeal]));
  const incidents = core.incidents.map((incident) => {
    const appeal = appealsByIncident.get(incident.id);
    const canSeeReason = Boolean(isAdmin || appeal?.submittedBy === viewerId);
    const entryRepresentativeId = incident.entryId ? entryById.get(incident.entryId)?.representativeUserId : null;
    const selected = incident.selectedOptions.map((option) => entryById.get(option)?.name ?? (option === "ct" ? "CT 方" : option === "t" ? "T 方" : mapLabel(option)));
    return {
      id: incident.id,
      entryId: incident.entryId,
      selectedEntities: incident.selectedOptions.map(option => ({ entryId: entryById.has(option) ? option : null, label: entryById.get(option)?.name ?? (option === "ct" ? "CT 方" : option === "t" ? "T 方" : mapLabel(option)) })),
      entryName: incident.entryId ? entryById.get(incident.entryId)?.name ?? "未知队伍" : "系统",
      selected,
      sourceLabel: "超时自动选择",
      appeal: appeal ? {
        id: appeal.id,
        status: appeal.status,
        submittedByViewer: Boolean(viewerId && appeal.submittedBy === viewerId),
        resolvedByViewer: Boolean(viewerId && appeal.resolvedBy === viewerId),
        resolutionScope: appeal.resolutionScope,
        statusLabel: gameplayStarted && appeal.status === "pending"
          ? "恢复窗口已结束（原待处理记录保留）"
          : APPEAL_STATUS_LABELS[appeal.status],
        reason: canSeeReason ? appeal.reason : null,
        resolutionNote: canSeeReason ? appeal.resolutionNote : null,
        mayResolve: isAdmin && !gameplayStarted && appeal.status === "pending",
      } : null,
      mayAppeal: Boolean(!recoveryClosed && viewerId && !appeal && (
        incident.representativeUserId === viewerId || entryRepresentativeId === viewerId
      )),
    };
  });

  const map = (value: string) => mapLabel(value);
  return {
    pendingInvalidation: Boolean(core.pendingInvalidation),
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
    maps: completedMaps.sort((a, b) => a.mapOrder - b.mapOrder).map(row => ({ ...row, mapLabel: map(row.mapName) })),
    steps: stepEntries,
    incidents,
    permissions: {
      isAdmin,
      viewerEntryId,
      canOperateCurrentTurn: Boolean(core.match.status === "in_progress" && viewerId && currentTurnEntry && entries.some((entry) => entry.id === currentTurnEntry && entry.isViewerVetoRepresentative)),
      canPause: Boolean(isAdmin && core.match.status === "in_progress" && core.session.startedAt && !core.session.completedAt && !core.session.pausedAt),
      canResume: Boolean(isAdmin && core.match.status === "in_progress" && core.session.pausedAt),
      canRewind: Boolean(!recoveryClosed && isAdmin && core.session.startedAt && core.match.status === "in_progress"),
      canSetManualPrivilegedEntry: Boolean(isAdmin && core.match.status === "scheduled" && !core.session.startedAt && !core.match.majorStageRunId && !core.match.qualificationRunId),
    },
  };
}

export type VetoRoomView = Awaited<ReturnType<typeof getVetoRoomView>>;

function orEntryId(entryAId: string, entryBId: string) {
  return or(eq(competitionEntries.id, entryAId), eq(competitionEntries.id, entryBId));
}
