import "server-only";

import { randomInt } from "node:crypto";
import { and, asc, eq, gte, inArray, isNotNull, ne, or } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { db } from "@/db/client";
import type { Match as DbMatch } from "@/db/schema";
import {
  competitionEntries,
  competitionQualificationEntrants,
  eventRosterMembers,
  majorStageEntrants,
  majorTournamentEntrants,
  matchMaps,
  matchRosterPlayers,
  matchRosters,
  matches,
  matchVetoAppeals,
  matchVetoSessions,
  matchVetoSteps,
  matchVetoTimeoutIncidents,
  seasons,
} from "@/db/schema";
import { applyMatchStatusTransitionInTx, lockMatchInTx } from "@/lib/match-rosters/service";
import { normalizeRegistrationConfig } from "@/lib/seasons/compatibility";
import { writeAuditInTx } from "@/lib/audit/write";
import { logEvent } from "@/lib/observability/server";
import { AppError, ErrorCode } from "@/lib/errors";
import type { Side, VetoActionType } from "@/types/match";
import {
  chooseVetoOptions,
  deriveHigherSeedEntry,
  deriveCurrentVetoTurn,
  getEligibleVetoMaps,
  getVetoTurnDefinitions,
  projectVetoMapPlan,
  type CurrentVetoTurn,
  type VetoStepFact,
} from "../veto-sequence";

const MAP_POOL_SIZE = 7;
const TIMEOUT_SETTLEMENT_MS = 2_000;
const MAX_RECONCILE_TURNS = 16;
const SYSTEM_ACTOR_ID = "veto-system";

type VetoMatch = Pick<DbMatch,
  | "id"
  | "seasonId"
  | "stage"
  | "round"
  | "entryAId"
  | "entryBId"
  | "status"
  | "format"
  | "scheduledAt"
  | "completedAt"
  | "majorStageRunId"
  | "qualificationRunId"
  | "ownership"
  | "createdAt"
  | "updatedAt"
>;

type VetoSession = typeof matchVetoSessions.$inferSelect;
type VetoStepRow = typeof matchVetoSteps.$inferSelect;

export interface VetoRoomCoreSnapshot {
  match: VetoMatch;
  session: VetoSession;
  steps: VetoStepRow[];
  incidents: Array<typeof matchVetoTimeoutIncidents.$inferSelect>;
  appeals: Array<typeof matchVetoAppeals.$inferSelect>;
  currentTurn: CurrentVetoTurn | null;
  serverNow: Date;
  effectiveForceAt: Date | null;
  previousMatchBlocker: boolean;
}

export type VetoMutationOutcome = "applied" | "idempotent" | "stale";

function logStaleVetoCommand(reason: "deadline" | "revision" | "turn"): void {
  logEvent({
    level: "info",
    event: "match.veto.command_stale",
    scope: "match",
    operation: "veto.command",
    safeContext: { outcome: "stale", reason, workflow: "veto_room" },
  });
}

async function databaseNow(tx: TxDb): Promise<Date> {
  const result = await tx.execute(sql`SELECT clock_timestamp() AS now`);
  const row = result.rows[0] as { now?: Date | string } | undefined;
  if (!row?.now) throw new AppError(ErrorCode.INTERNAL_ERROR, "读取数据库时间失败。");
  return row.now instanceof Date ? row.now : new Date(row.now);
}

async function resolveFrozenPrivilegedEntryInTx(tx: TxDb, match: VetoMatch): Promise<string | null> {
  if (match.majorStageRunId && match.qualificationRunId) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "比赛同时关联了 Major 阶段与资格赛运行，无法确定 BP 先手。");
  }

  if (match.majorStageRunId) {
    const entrants = await tx
      .select({ entryId: majorTournamentEntrants.competitionEntryId, seed: majorStageEntrants.stageSeed })
      .from(majorStageEntrants)
      .innerJoin(majorTournamentEntrants, eq(majorTournamentEntrants.id, majorStageEntrants.tournamentEntrantId))
      .where(and(
        eq(majorStageEntrants.stageRunId, match.majorStageRunId),
        inArray(majorTournamentEntrants.competitionEntryId, [match.entryAId, match.entryBId]),
      ));
    return higherSeedEntry(match, entrants.map((row) => ({ entryId: row.entryId, seed: row.seed })));
  }

  if (match.qualificationRunId) {
    const entrants = await tx
      .select({ entryId: competitionQualificationEntrants.competitionEntryId, seed: competitionQualificationEntrants.preliminarySeed })
      .from(competitionQualificationEntrants)
      .where(and(
        eq(competitionQualificationEntrants.runId, match.qualificationRunId),
        inArray(competitionQualificationEntrants.competitionEntryId, [match.entryAId, match.entryBId]),
      ));
    return higherSeedEntry(match, entrants.map((row) => ({ entryId: row.entryId, seed: row.seed })));
  }

  // Only a true manual Match reaches this branch. The season admin must select
  // the privileged entry explicitly; entryAId is never a fallback authority.
  return null;
}

function higherSeedEntry(
  match: VetoMatch,
  entrants: Array<{ entryId: string; seed: number }>,
): string {
  const entryId = deriveHigherSeedEntry({
    entryAId: match.entryAId,
    entryBId: match.entryBId,
    entrants,
  });
  if (!entryId) throw new AppError(ErrorCode.VALIDATION_FAILED, "本场双方缺少有效且不重复的冻结预排名，不能初始化 BP 房间。");
  return entryId;
}

async function getSessionForUpdateInTx(tx: TxDb, match: VetoMatch): Promise<VetoSession> {
  const [existing] = await tx
    .select()
    .from(matchVetoSessions)
    .where(eq(matchVetoSessions.matchId, match.id))
    .for("update");
  if (existing) return existing;

  const privilegedEntryId = await resolveFrozenPrivilegedEntryInTx(tx, match);
  const [inserted] = await tx
    .insert(matchVetoSessions)
    .values({ matchId: match.id, privilegedEntryId })
    .onConflictDoNothing()
    .returning();
  if (inserted) return inserted;

  const [raced] = await tx
    .select()
    .from(matchVetoSessions)
    .where(eq(matchVetoSessions.matchId, match.id))
    .for("update");
  if (!raced) throw new AppError(ErrorCode.INTERNAL_ERROR, "初始化 BP 房间失败。");
  return raced;
}

async function getSessionForReadInTx(tx: TxDb, match: VetoMatch): Promise<VetoSession> {
  const [existing] = await tx.select().from(matchVetoSessions)
    .where(eq(matchVetoSessions.matchId, match.id))
    .limit(1);
  if (existing) return existing;

  const privilegedEntryId = await resolveFrozenPrivilegedEntryInTx(tx, match);
  return {
    matchId: match.id,
    privilegedEntryId,
    vetoTeamAEntryId: null,
    entryAStartRequestedAt: null,
    entryAStartRequestedBy: null,
    entryBStartRequestedAt: null,
    entryBStartRequestedBy: null,
    mapPoolSnapshot: null,
    startedAt: null,
    completedAt: null,
    currentTurnKey: null,
    turnStartedAt: null,
    turnDeadlineAt: null,
    pausedAt: null,
    pausedBy: null,
    pauseReason: null,
    revision: 0,
    createdAt: match.createdAt,
    updatedAt: match.updatedAt,
  };
}

async function readStepsInTx(tx: TxDb, matchId: string): Promise<VetoStepRow[]> {
  return tx.select().from(matchVetoSteps).where(eq(matchVetoSteps.matchId, matchId)).orderBy(asc(matchVetoSteps.stepOrder));
}

function asStepFacts(steps: readonly VetoStepRow[]): VetoStepFact[] {
  return steps.filter((step): step is VetoStepRow & { turnKey: string } => step.turnKey !== null).map((step) => ({
    turnKey: step.turnKey,
    actionType: step.actionType as VetoActionType,
    mapName: step.mapName,
    entryId: step.entryId,
    side: step.side as Side | null,
  }));
}

function currentTurn(match: VetoMatch, session: VetoSession, steps: readonly VetoStepRow[]): CurrentVetoTurn | null {
  if (!session.startedAt || session.completedAt || !session.mapPoolSnapshot) return null;
  return deriveCurrentVetoTurn({
    format: match.format,
    entryAId: match.entryAId,
    entryBId: match.entryBId,
    privilegedEntryId: session.privilegedEntryId,
    vetoTeamAEntryId: session.vetoTeamAEntryId,
    mapPool: session.mapPoolSnapshot,
    steps: asStepFacts(steps),
  });
}

function roleSelectSuccessorDuration(
  match: VetoMatch,
  session: VetoSession,
  vetoTeamAEntryId: string,
  steps: readonly VetoStepRow[],
): number {
  const next = deriveCurrentVetoTurn({
    format: match.format,
    entryAId: match.entryAId,
    entryBId: match.entryBId,
    privilegedEntryId: session.privilegedEntryId,
    vetoTeamAEntryId,
    mapPool: session.mapPoolSnapshot ?? [],
    steps: asStepFacts(steps),
  });
  if (!next || next.actionType === "role_select" || next.durationSeconds === null) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "无法确定 VETO A 选择后的回合时限。");
  }
  return next.durationSeconds;
}

async function getRepresentativeUserIdInTx(tx: TxDb, matchId: string, entryId: string): Promise<string | null> {
  const [row] = await tx
    .select({ userId: eventRosterMembers.userId })
    .from(matchRosters)
    .innerJoin(matchRosterPlayers, eq(matchRosterPlayers.rosterId, matchRosters.id))
    .innerJoin(eventRosterMembers, eq(eventRosterMembers.id, matchRosterPlayers.eventRosterMemberId))
    .where(and(
      eq(matchRosters.matchId, matchId),
      eq(matchRosters.entryId, entryId),
      eq(matchRosters.status, "confirmed"),
      eq(matchRosterPlayers.isVetoRepresentative, true),
      eq(matchRosterPlayers.isStarter, true),
    ))
    .limit(1);
  return row?.userId ?? null;
}

async function hasConfirmedLineupsInTx(tx: TxDb, match: VetoMatch): Promise<boolean> {
  const confirmed = await tx.select({ entryId: matchRosters.entryId })
    .from(matchRosters)
    .where(and(
      eq(matchRosters.matchId, match.id),
      eq(matchRosters.status, "confirmed"),
      inArray(matchRosters.entryId, [match.entryAId, match.entryBId]),
    ));
  return new Set(confirmed.map((row) => row.entryId)).size === 2;
}

async function getEntryRepresentativeUserIdInTx(tx: TxDb, entryId: string): Promise<string | null> {
  const [row] = await tx
    .select({ userId: competitionEntries.representativeUserId })
    .from(competitionEntries)
    .where(eq(competitionEntries.id, entryId))
    .limit(1);
  return row?.userId ?? null;
}

async function loadStartTimingInTx(
  tx: TxDb,
  match: VetoMatch,
): Promise<{ effectiveForceAt: Date | null; previousMatchBlocker: boolean }> {
  if (!match.scheduledAt) return { effectiveForceAt: null, previousMatchBlocker: false };
  const entries = [match.entryAId, match.entryBId];
  const previousMatchPredicate = or(
    inArray(matches.entryAId, entries),
    inArray(matches.entryBId, entries),
  );
  const [activePrevious] = await tx
    .select({ id: matches.id })
    .from(matches)
    .where(and(
      eq(matches.seasonId, match.seasonId),
      ne(matches.id, match.id),
      eq(matches.status, "in_progress"),
      previousMatchPredicate,
    ))
    .limit(1);
  if (activePrevious) return { effectiveForceAt: null, previousMatchBlocker: true };

  const opensAt = new Date(match.scheduledAt.getTime() - 15 * 60_000);
  const completions = await tx
    .select({ completedAt: matches.completedAt })
    .from(matches)
    .where(and(
      eq(matches.seasonId, match.seasonId),
      ne(matches.id, match.id),
      eq(matches.status, "finished"),
      previousMatchPredicate,
      isNotNull(matches.completedAt),
      gte(matches.completedAt, opensAt),
    ));
  const latestPreviousCompletion = completions.reduce<Date | null>((latest, row) => {
    if (!row.completedAt) return latest;
    return !latest || row.completedAt > latest ? row.completedAt : latest;
  }, null);
  const normalForceAt = new Date(match.scheduledAt.getTime() + 15 * 60_000);
  const afterPrevious = latestPreviousCompletion ? new Date(latestPreviousCompletion.getTime() + 15 * 60_000) : normalForceAt;
  return {
    effectiveForceAt: afterPrevious > normalForceAt ? afterPrevious : normalForceAt,
    previousMatchBlocker: false,
  };
}

async function getMapPoolInTx(tx: TxDb, match: VetoMatch): Promise<string[]> {
  const [season] = await tx
    .select({ registrationConfig: seasons.registrationConfig })
    .from(seasons)
    .where(eq(seasons.id, match.seasonId))
    .limit(1);
  if (!season) throw new AppError(ErrorCode.NOT_FOUND, "赛事不存在。");
  const mapPool = normalizeRegistrationConfig(season.registrationConfig).mapPool;
  if (mapPool.length !== MAP_POOL_SIZE || new Set(mapPool).size !== MAP_POOL_SIZE || mapPool.some((mapName) => !mapName.trim())) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "当前赛事地图池必须包含七张不重复地图，才能开始 BP。");
  }
  return [...mapPool];
}

async function updateSessionInTx(tx: TxDb, matchId: string, session: VetoSession, patch: Partial<VetoSession>): Promise<VetoSession> {
  const [updated] = await tx
    .update(matchVetoSessions)
    .set({ ...patch, revision: session.revision + 1, updatedAt: sql`clock_timestamp()` })
    .where(eq(matchVetoSessions.matchId, matchId))
    .returning();
  if (!updated) throw new AppError(ErrorCode.INTERNAL_ERROR, "更新 BP 房间失败。");
  return updated;
}

async function tryStartSessionInTx(
  tx: TxDb,
  match: VetoMatch,
  session: VetoSession,
  now: Date,
  actorId: string,
): Promise<VetoSession> {
  if (session.startedAt || match.status !== "scheduled" || session.privilegedEntryId === null) return session;
  const entryARep = await getRepresentativeUserIdInTx(tx, match.id, match.entryAId);
  const entryBRep = await getRepresentativeUserIdInTx(tx, match.id, match.entryBId);
  const entryACaptain = await getEntryRepresentativeUserIdInTx(tx, match.entryAId);
  const entryBCaptain = await getEntryRepresentativeUserIdInTx(tx, match.entryBId);
  const timing = await loadStartTimingInTx(tx, match);
  if (timing.previousMatchBlocker) return session;

  const requestAIsCurrentBpRep = Boolean(session.entryAStartRequestedBy && entryARep === session.entryAStartRequestedBy);
  const requestBIsCurrentBpRep = Boolean(session.entryBStartRequestedBy && entryBRep === session.entryBStartRequestedBy);
  const isForceTime = timing.effectiveForceAt !== null && now >= timing.effectiveForceAt;
  const requestAIsValid = requestAIsCurrentBpRep || (isForceTime && Boolean(session.entryAStartRequestedBy && entryACaptain === session.entryAStartRequestedBy));
  const requestBIsValid = requestBIsCurrentBpRep || (isForceTime && Boolean(session.entryBStartRequestedBy && entryBCaptain === session.entryBStartRequestedBy));
  const bothRepsReady = requestAIsCurrentBpRep && requestBIsCurrentBpRep;
  const withinOpenWindow = match.scheduledAt === null || now >= new Date(match.scheduledAt.getTime() - 15 * 60_000);
  const mayStart = match.scheduledAt === null
    ? bothRepsReady
    : withinOpenWindow && (bothRepsReady || (isForceTime && (requestAIsValid || requestBIsValid)));
  if (!mayStart) return session;
  if (!await hasConfirmedLineupsInTx(tx, match)) return session;

  const mapPoolSnapshot = await getMapPoolInTx(tx, match);
  const existingSteps = await readStepsInTx(tx, match.id);
  if (existingSteps.length > 0) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "本场已有旧版 BP 记录，请先由管理员在 Veto Room 中处理后再开始。");
  }

  await applyMatchStatusTransitionInTx(tx, { matchId: match.id, nextStatus: "in_progress", actorId });
  const started = await updateSessionInTx(tx, match.id, session, {
    startedAt: now,
    mapPoolSnapshot,
    currentTurnKey: "choose-veto-team-a",
    turnStartedAt: now,
    turnDeadlineAt: new Date(now.getTime() + 45_000),
  });
  await writeAuditInTx(tx, {
    seasonId: match.seasonId,
    action: "match.veto.start",
    actorId,
    targetId: match.id,
    meta: { format: match.format, privilegedEntryId: session.privilegedEntryId },
  });
  return started;
}

async function completeMapPlanInTx(
  tx: TxDb,
  match: VetoMatch,
  session: VetoSession,
  steps: readonly VetoStepRow[],
  now: Date,
): Promise<VetoSession> {
  const existingMaps = await tx.select().from(matchMaps).where(eq(matchMaps.matchId, match.id));
  if (existingMaps.some((row) => row.scoreA !== null || row.scoreB !== null || row.completedAt !== null)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "已有地图比分或正式地图事实，无法覆盖当前 BP 地图计划。");
  }
  const plan = projectVetoMapPlan({ steps: asStepFacts(steps), entryAId: match.entryAId, format: match.format });
  if (plan.length !== (match.format === "bo1" ? 1 : match.format === "bo3" ? 3 : 5)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "BP 步骤未形成完整地图计划。");
  }
  await tx.delete(matchMaps).where(eq(matchMaps.matchId, match.id));
  await tx.insert(matchMaps).values(plan.map((map) => ({ matchId: match.id, ...map })));
  const updated = await updateSessionInTx(tx, match.id, session, {
    completedAt: now,
    currentTurnKey: null,
    turnStartedAt: null,
    turnDeadlineAt: null,
  });
  await writeAuditInTx(tx, {
    seasonId: match.seasonId,
    action: "match.veto.complete",
    actorId: SYSTEM_ACTOR_ID,
    targetId: match.id,
    meta: { format: match.format, mapCount: plan.length },
  });
  return updated;
}

async function advanceAfterLogicalTurnInTx(
  tx: TxDb,
  match: VetoMatch,
  session: VetoSession,
  logicalStart: Date,
  now: Date,
): Promise<VetoSession> {
  const steps = await readStepsInTx(tx, match.id);
  const next = currentTurn(match, session, steps);
  if (!next) return completeMapPlanInTx(tx, match, session, steps, now);
  if (next.actor === "system") {
    return updateSessionInTx(tx, match.id, session, {
      currentTurnKey: next.key,
      turnStartedAt: null,
      turnDeadlineAt: null,
    });
  }
  if (next.durationSeconds === null) throw new AppError(ErrorCode.INTERNAL_ERROR, "BP 回合缺少时限。");
  return updateSessionInTx(tx, match.id, session, {
    currentTurnKey: next.key,
    turnStartedAt: logicalStart,
    turnDeadlineAt: new Date(logicalStart.getTime() + next.durationSeconds * 1_000),
  });
}

async function appendSystemDeciderInTx(
  tx: TxDb,
  match: VetoMatch,
  session: VetoSession,
  turn: CurrentVetoTurn,
  now: Date,
): Promise<VetoSession> {
  const steps = await readStepsInTx(tx, match.id);
  const pool = session.mapPoolSnapshot ?? [];
  const remaining = getEligibleVetoMaps(pool, asStepFacts(steps));
  if (remaining.length !== 1) throw new AppError(ErrorCode.VALIDATION_FAILED, "当前 BP 不满足唯一决胜图条件。");
  const nextOrder = steps.reduce((max, step) => Math.max(max, step.stepOrder), 0) + 1;
  await tx.insert(matchVetoSteps).values({
    matchId: match.id,
    stepOrder: nextOrder,
    actionType: "decider",
    mapName: remaining[0]!,
    entryId: null,
    side: null,
    source: "system",
    actorUserId: null,
    clientRequestId: null,
    turnKey: turn.key,
    createdAt: now,
  });
  const advanced = await updateSessionInTx(tx, match.id, session, {
    currentTurnKey: turn.key,
    turnStartedAt: null,
    turnDeadlineAt: null,
  });
  const afterDecider = currentTurn(match, advanced, await readStepsInTx(tx, match.id));
  if (!afterDecider) return completeMapPlanInTx(tx, match, advanced, await readStepsInTx(tx, match.id), now);
  return advanceAfterLogicalTurnInTx(tx, match, advanced, now, now);
}

async function reconcileVetoSessionInTx(
  tx: TxDb,
  match: VetoMatch,
  initialSession: VetoSession,
  now: Date,
  actorId = SYSTEM_ACTOR_ID,
): Promise<VetoSession> {
  let session = await tryStartSessionInTx(tx, match, initialSession, now, actorId);
  let timedOutTurns = 0;
  if (
    !session.startedAt ||
    session.completedAt ||
    session.pausedAt ||
    !session.mapPoolSnapshot ||
    (match.status !== "scheduled" && match.status !== "in_progress")
  ) return session;

  for (let processed = 0; processed < MAX_RECONCILE_TURNS; processed += 1) {
    const steps = await readStepsInTx(tx, match.id);
    const turn = currentTurn(match, session, steps);
    if (!turn) {
      session = await completeMapPlanInTx(tx, match, session, steps, now);
      logTimeoutCatchUp(timedOutTurns);
      return session;
    }
    if (turn.actor === "system" && turn.actionType === "decider") {
      session = await appendSystemDeciderInTx(tx, match, session, turn, now);
      if (session.completedAt) return session;
      continue;
    }

    const deadline = session.turnDeadlineAt;
    if (!deadline || session.currentTurnKey !== turn.key || now.getTime() < deadline.getTime() + TIMEOUT_SETTLEMENT_MS) {
      if (session.currentTurnKey !== turn.key) {
        session = await updateSessionInTx(tx, match.id, session, { currentTurnKey: turn.key });
      }
      logTimeoutCatchUp(timedOutTurns);
      return session;
    }

    const stepFacts = asStepFacts(steps);
    let eligibleOptions: string[];
    let selectedOptions: string[];
    const timeoutEntryId = turn.actorEntryId;
    if (turn.actionType === "role_select") {
      eligibleOptions = [match.entryAId, match.entryBId];
      selectedOptions = chooseVetoOptions(eligibleOptions, 1, (max) => randomInt(max));
    } else if (turn.actionType === "side_pick") {
      eligibleOptions = ["ct", "t"];
      selectedOptions = chooseVetoOptions(eligibleOptions, 1, (max) => randomInt(max));
    } else if (turn.actionType === "ban" || turn.actionType === "pick") {
      eligibleOptions = getEligibleVetoMaps(session.mapPoolSnapshot ?? [], stepFacts);
      selectedOptions = chooseVetoOptions(eligibleOptions, turn.count - turn.completed, (max) => randomInt(max));
    } else {
      throw new AppError(ErrorCode.INTERNAL_ERROR, "无法自动完成当前 BP 回合。");
    }
    if (selectedOptions.length !== (turn.actionType === "ban" || turn.actionType === "pick" ? turn.count - turn.completed : 1)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "当前 BP 回合没有足够的合法候选。");
    }

    const deadlineAt = deadline;
    const incidentResolvedAt = now;
    const representativeUserId = timeoutEntryId ? await getRepresentativeUserIdInTx(tx, match.id, timeoutEntryId) : null;
    await tx.insert(matchVetoTimeoutIncidents).values({
      matchId: match.id,
      turnKey: turn.key,
      entryId: timeoutEntryId,
      representativeUserId,
      deadlineAt,
      resolvedAt: incidentResolvedAt,
      eligibleOptions,
      selectedOptions,
      createdAt: now,
    });
    timedOutTurns += 1;
    logEvent({
      level: "info",
      event: "match.veto.timeout_resolved",
      scope: "match",
      operation: "veto.timeout",
      durationMs: now.getTime() - deadlineAt.getTime(),
      safeContext: { reason: "deadline", workflow: "veto_room" },
    });

    if (turn.actionType === "role_select") {
      const roleEntry = selectedOptions[0]!;
      const nextDurationSeconds = roleSelectSuccessorDuration(match, session, roleEntry, steps);
      session = await updateSessionInTx(tx, match.id, session, {
        vetoTeamAEntryId: roleEntry,
        currentTurnKey: "ban-veto-a-opening",
        turnStartedAt: deadlineAt,
        turnDeadlineAt: new Date(deadlineAt.getTime() + nextDurationSeconds * 1_000),
      });
    } else {
      let order = steps.reduce((max, step) => Math.max(max, step.stepOrder), 0);
      for (const option of selectedOptions) {
        order += 1;
        await tx.insert(matchVetoSteps).values({
          matchId: match.id,
          stepOrder: order,
          actionType: turn.actionType,
          mapName: turn.actionType === "side_pick" ? turn.mapName! : option,
          entryId: timeoutEntryId,
          side: turn.actionType === "side_pick" ? option as Side : null,
          source: "timeout",
          actorUserId: null,
          clientRequestId: null,
          turnKey: turn.key,
          createdAt: now,
        });
      }
      session = await updateSessionInTx(tx, match.id, session, {
        currentTurnKey: turn.key,
        turnStartedAt: null,
        turnDeadlineAt: null,
      });
      session = await advanceAfterLogicalTurnInTx(tx, match, session, deadlineAt, now);
    }
    await writeAuditInTx(tx, {
      seasonId: match.seasonId,
      action: "match.veto.timeout",
      actorId: SYSTEM_ACTOR_ID,
      targetId: match.id,
      meta: { turnKey: turn.key, entryId: timeoutEntryId, selectedCount: selectedOptions.length },
    });
    if (session.completedAt || session.pausedAt) {
      logTimeoutCatchUp(timedOutTurns);
      return session;
    }
  }

  logTimeoutCatchUp(timedOutTurns);
  return session;
}

function logTimeoutCatchUp(count: number): void {
  if (count <= 1) return;
  logEvent({
    level: "info",
    event: "match.veto.timeout_catch_up",
    scope: "match",
    operation: "veto.timeout",
    safeContext: { count, phase: "timeout_catch_up", workflow: "veto_room" },
  });
}

async function loadCoreSnapshotInTx(
  tx: TxDb,
  match: VetoMatch,
  session: VetoSession,
): Promise<VetoRoomCoreSnapshot> {
  const steps = await readStepsInTx(tx, match.id);
  const incidents = await tx.select().from(matchVetoTimeoutIncidents)
    .where(eq(matchVetoTimeoutIncidents.matchId, match.id))
    .orderBy(asc(matchVetoTimeoutIncidents.createdAt));
  const appealRows = await tx.select({ appeal: matchVetoAppeals })
    .from(matchVetoAppeals)
    .innerJoin(matchVetoTimeoutIncidents, eq(matchVetoTimeoutIncidents.id, matchVetoAppeals.timeoutIncidentId))
    .where(eq(matchVetoTimeoutIncidents.matchId, match.id));
  const appeals = appealRows.map((row) => row.appeal);
  const timing = await loadStartTimingInTx(tx, match);
  const serverNow = await databaseNow(tx);
  return {
    match,
    session,
    steps,
    incidents,
    appeals,
    currentTurn: currentTurn(match, session, steps),
    serverNow,
    effectiveForceAt: timing.effectiveForceAt,
    previousMatchBlocker: timing.previousMatchBlocker,
  };
}

export async function readVetoRoomCore(matchId: string): Promise<VetoRoomCoreSnapshot> {
  return db.transaction(async (tx) => {
    const match = await lockMatchInTx(tx, matchId);
    const session = await getSessionForUpdateInTx(tx, match);
    const reconcileNow = await databaseNow(tx);
    const reconciled = await reconcileVetoSessionInTx(tx, match, session, reconcileNow);
    return loadCoreSnapshotInTx(tx, match, reconciled);
  });
}

/** Public display reads do not reconcile, initialize, or lock match/session rows. */
export async function readVetoRoomSnapshot(matchId: string): Promise<VetoRoomCoreSnapshot> {
  return db.transaction(async (tx) => {
    const match = await tx.query.matches.findFirst({ where: eq(matches.id, matchId) });
    if (!match) throw new AppError(ErrorCode.MATCH_NOT_FOUND, "比赛不存在。");
    const session = await getSessionForReadInTx(tx, match);
    return loadCoreSnapshotInTx(tx, match, session);
  });
}

/** Reconcile a deterministic lifecycle boundary without making ordinary polling take row locks. */
export async function reconcileVetoRoom(matchId: string): Promise<VetoMutationOutcome> {
  return db.transaction(async (tx) => {
    const match = await lockMatchInTx(tx, matchId);
    const session = await getSessionForUpdateInTx(tx, match);
    const now = await databaseNow(tx);
    const reconciled = await reconcileVetoSessionInTx(tx, match, session, now);
    return reconciled.revision === session.revision ? "idempotent" : "applied";
  });
}

export async function setManualPrivilegedEntry(input: {
  matchId: string;
  entryId: string;
  actorId: string;
}): Promise<VetoMutationOutcome> {
  return db.transaction(async (tx) => {
    const match = await lockMatchInTx(tx, input.matchId);
    if (match.majorStageRunId || match.qualificationRunId) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "有冻结预排名的比赛不能手动指定 BP 先手。");
    }
    if (match.status !== "scheduled") throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "只有待进行比赛可以指定 BP 先手。");
    if (input.entryId !== match.entryAId && input.entryId !== match.entryBId) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "指定队伍不属于本场比赛。");
    }
    const session = await getSessionForUpdateInTx(tx, match);
    if (session.startedAt) throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "BP 已开始，不能更改先手队伍。");
    if (session.privilegedEntryId === input.entryId) return "idempotent";
    await updateSessionInTx(tx, match.id, session, { privilegedEntryId: input.entryId });
    await writeAuditInTx(tx, {
      seasonId: match.seasonId,
      action: "match.veto.privileged_entry_set",
      actorId: input.actorId,
      targetId: match.id,
      meta: { entryId: input.entryId },
    });
    return "applied";
  });
}

async function changeRepresentativeInTx(
  tx: TxDb,
  input: { match: VetoMatch; session: VetoSession; entryId: string; memberId: string; actorId: string; isAdmin: boolean; claim: boolean },
): Promise<VetoMutationOutcome> {
  const { match, session } = input;
  if (match.status === "finished" || match.status === "cancelled") {
    throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "已结束或取消的比赛不能更换 BP 负责人。");
  }
  if (!session.startedAt && match.status !== "scheduled") {
    throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "比赛开始后不能再认领 BP 负责人。");
  }
  const [roster] = await tx
    .select()
    .from(matchRosters)
    .where(and(eq(matchRosters.matchId, match.id), eq(matchRosters.entryId, input.entryId)))
    .for("update");
  if (!roster) throw new AppError(ErrorCode.VALIDATION_FAILED, "请先由管理员确认本场首发阵容。");
  if (session.startedAt && !input.isAdmin) throw new AppError(ErrorCode.FORBIDDEN, "BP 开始后只有赛事管理员可以更换 BP 负责人。");
  if (input.entryId !== match.entryAId && input.entryId !== match.entryBId) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "所选队伍不属于本场比赛。");
  }
  const [player] = await tx
    .select({ eventRosterMemberId: matchRosterPlayers.eventRosterMemberId, isStarter: matchRosterPlayers.isStarter, userId: eventRosterMembers.userId, isVetoRepresentative: matchRosterPlayers.isVetoRepresentative })
    .from(matchRosterPlayers)
    .innerJoin(eventRosterMembers, eq(eventRosterMembers.id, matchRosterPlayers.eventRosterMemberId))
    .where(and(
      eq(matchRosterPlayers.rosterId, roster.id),
      eq(matchRosterPlayers.eventRosterMemberId, input.memberId),
    ))
    .for("update");
  if (!player?.isStarter) throw new AppError(ErrorCode.VALIDATION_FAILED, "BP 负责人必须是本场首发队员。");

  if (input.claim) {
    if (player.userId !== input.actorId) throw new AppError(ErrorCode.FORBIDDEN, "只有本场首发本人可以认领 BP 负责人。");
    const [existing] = await tx.select({ id: matchRosterPlayers.eventRosterMemberId })
      .from(matchRosterPlayers)
      .where(and(eq(matchRosterPlayers.rosterId, roster.id), eq(matchRosterPlayers.isVetoRepresentative, true)))
      .limit(1);
    if (existing) throw new AppError(ErrorCode.VALIDATION_FAILED, "本队已经指定 BP 负责人。");
  } else if (!input.isAdmin) {
    const representativeUserId = await getEntryRepresentativeUserIdInTx(tx, input.entryId);
    if (representativeUserId !== input.actorId) throw new AppError(ErrorCode.FORBIDDEN, "只有本队赛事负责人可以指定 BP 负责人。");
  }

  if (player.isVetoRepresentative) return "idempotent";
  await tx.update(matchRosterPlayers)
    .set({ isVetoRepresentative: false })
    .where(and(eq(matchRosterPlayers.rosterId, roster.id), eq(matchRosterPlayers.isVetoRepresentative, true)));
  await tx.update(matchRosterPlayers)
    .set({ isVetoRepresentative: true })
    .where(and(eq(matchRosterPlayers.rosterId, roster.id), eq(matchRosterPlayers.eventRosterMemberId, input.memberId), eq(matchRosterPlayers.isStarter, true)));

  const sessionPatch = input.entryId === match.entryAId
    ? { entryAStartRequestedAt: null, entryAStartRequestedBy: null }
    : { entryBStartRequestedAt: null, entryBStartRequestedBy: null };
  await updateSessionInTx(tx, match.id, session, sessionPatch);
  await writeAuditInTx(tx, {
    seasonId: match.seasonId,
    action: input.claim ? "match.veto.representative_claim" : session.startedAt ? "match.veto.admin_reassign" : "match.veto.representative_set",
    actorId: input.actorId,
    targetId: match.id,
    meta: { entryId: input.entryId },
  });
  return "applied";
}

export async function setVetoRepresentative(input: {
  matchId: string;
  entryId: string;
  eventRosterMemberId: string;
  actorId: string;
  isAdmin: boolean;
  claim?: boolean;
}): Promise<VetoMutationOutcome> {
  return db.transaction(async (tx) => {
    const match = await lockMatchInTx(tx, input.matchId);
    const session = await getSessionForUpdateInTx(tx, match);
    return changeRepresentativeInTx(tx, {
      match,
      session,
      entryId: input.entryId,
      memberId: input.eventRosterMemberId,
      actorId: input.actorId,
      isAdmin: input.isAdmin,
      claim: input.claim ?? false,
    });
  });
}

export async function claimVetoRepresentative(input: {
  matchId: string;
  entryId: string;
  actorId: string;
}): Promise<VetoMutationOutcome> {
  return db.transaction(async (tx) => {
    const match = await lockMatchInTx(tx, input.matchId);
    const session = await getSessionForUpdateInTx(tx, match);
    const [roster] = await tx.select({ id: matchRosters.id })
      .from(matchRosters)
      .where(and(eq(matchRosters.matchId, match.id), eq(matchRosters.entryId, input.entryId)))
      .for("update");
    if (!roster) throw new AppError(ErrorCode.VALIDATION_FAILED, "请先由管理员确认本场首发阵容。");
    const [player] = await tx.select({ eventRosterMemberId: matchRosterPlayers.eventRosterMemberId })
      .from(matchRosterPlayers)
      .innerJoin(eventRosterMembers, eq(eventRosterMembers.id, matchRosterPlayers.eventRosterMemberId))
      .where(and(
        eq(matchRosterPlayers.rosterId, roster.id),
        eq(matchRosterPlayers.isStarter, true),
        eq(eventRosterMembers.userId, input.actorId),
      ))
      .for("update");
    if (!player) throw new AppError(ErrorCode.FORBIDDEN, "只有本场首发队员可以认领 BP 负责人。");
    return changeRepresentativeInTx(tx, {
      match,
      session,
      entryId: input.entryId,
      memberId: player.eventRosterMemberId,
      actorId: input.actorId,
      isAdmin: false,
      claim: true,
    });
  });
}

export async function requestVetoStart(input: {
  matchId: string;
  entryId: string;
  actorId: string;
  expectedRevision: number;
  expectedTurnKey: string | null;
}): Promise<VetoMutationOutcome> {
  return db.transaction(async (tx) => {
    const receivedAt = await databaseNow(tx);
    const match = await lockMatchInTx(tx, input.matchId);
    let session = await getSessionForUpdateInTx(tx, match);
    session = await reconcileVetoSessionInTx(tx, match, session, receivedAt, input.actorId);
    if (session.startedAt) return "idempotent";
    if (session.revision !== input.expectedRevision || session.currentTurnKey !== input.expectedTurnKey) {
      logStaleVetoCommand(session.currentTurnKey !== input.expectedTurnKey ? "turn" : "revision");
      return "stale";
    }
    if (match.status !== "scheduled") throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "当前比赛状态不能开始 BP。");
    if (session.privilegedEntryId === null) throw new AppError(ErrorCode.VALIDATION_FAILED, "请先由赛事管理员指定本场 BP 先手队伍。");
    if (input.entryId !== match.entryAId && input.entryId !== match.entryBId) throw new AppError(ErrorCode.VALIDATION_FAILED, "请求队伍不属于本场比赛。");
    if (!await hasConfirmedLineupsInTx(tx, match)) throw new AppError(ErrorCode.VALIDATION_FAILED, "双方本场首发都确认后才能开始 BP。");

    const bpRepresentativeId = await getRepresentativeUserIdInTx(tx, match.id, input.entryId);
    const entryRepresentativeId = await getEntryRepresentativeUserIdInTx(tx, input.entryId);
    const timing = await loadStartTimingInTx(tx, match);
    const isBpRepresentative = bpRepresentativeId === input.actorId;
    const mayCaptainRequest = timing.effectiveForceAt !== null && receivedAt >= timing.effectiveForceAt && entryRepresentativeId === input.actorId;
    if (!isBpRepresentative && !mayCaptainRequest) {
      throw new AppError(ErrorCode.FORBIDDEN, "当前只有本场 BP 负责人可以确认开始；宽限时间后赛事负责人可代为请求。");
    }
    if (match.scheduledAt && receivedAt < new Date(match.scheduledAt.getTime() - 15 * 60_000)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "BP 尚未开放，请在计划时间前十五分钟后确认。");
    }
    if (!match.scheduledAt && !isBpRepresentative) {
      throw new AppError(ErrorCode.FORBIDDEN, "没有计划时间时只能由 BP 负责人确认开始。");
    }

    const isEntryA = input.entryId === match.entryAId;
    const existingRequester = isEntryA ? session.entryAStartRequestedBy : session.entryBStartRequestedBy;
    const existingAt = isEntryA ? session.entryAStartRequestedAt : session.entryBStartRequestedAt;
    if (existingRequester === input.actorId && existingAt) return "idempotent";
    const updated = await updateSessionInTx(tx, match.id, session, isEntryA
      ? { entryAStartRequestedAt: receivedAt, entryAStartRequestedBy: input.actorId }
      : { entryBStartRequestedAt: receivedAt, entryBStartRequestedBy: input.actorId });
    await writeAuditInTx(tx, {
      seasonId: match.seasonId,
      action: "match.veto.start_request",
      actorId: input.actorId,
      targetId: match.id,
      meta: { entryId: input.entryId, asRepresentative: !isBpRepresentative },
    });
    const reconciled = await reconcileVetoSessionInTx(tx, match, updated, receivedAt, input.actorId);
    if (!reconciled.startedAt) {
      const postRequestTiming = await loadStartTimingInTx(tx, match);
      logEvent({
        level: "info",
        event: "match.veto.start_blocked",
        scope: "match",
        operation: "veto.start",
        safeContext: {
          phase: postRequestTiming.previousMatchBlocker ? "previous_match" : "awaiting_other_entry",
          workflow: "veto_room",
        },
      });
    }
    return "applied";
  });
}

export async function submitVetoCommand(input: {
  matchId: string;
  actorId: string;
  expectedRevision: number;
  expectedTurnKey: string;
  clientRequestId: string;
  command: { kind: "role_select"; entryId: string } | { kind: "step"; actionType: VetoActionType; mapName?: string; side?: Side };
}): Promise<VetoMutationOutcome> {
  return db.transaction(async (tx) => {
    const receivedAt = await databaseNow(tx);
    const match = await lockMatchInTx(tx, input.matchId);
    let session = await getSessionForUpdateInTx(tx, match);

    if (input.command.kind === "step") {
      const [existingRequest] = await tx.select({ id: matchVetoSteps.id })
        .from(matchVetoSteps)
        .where(and(eq(matchVetoSteps.matchId, match.id), eq(matchVetoSteps.clientRequestId, input.clientRequestId)))
        .limit(1);
      if (existingRequest) return "idempotent";
    }

    session = await reconcileVetoSessionInTx(tx, match, session, receivedAt, input.actorId);
    const steps = await readStepsInTx(tx, match.id);
    const turn = currentTurn(match, session, steps);
    if (session.revision !== input.expectedRevision) {
      logStaleVetoCommand("revision");
      return "stale";
    }
    if (session.currentTurnKey !== input.expectedTurnKey || turn?.key !== input.expectedTurnKey) {
      logStaleVetoCommand("turn");
      return "stale";
    }
    if (!session.startedAt || session.completedAt || session.pausedAt || match.status !== "in_progress") {
      throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "当前 BP 房间不可操作。");
    }
    if (turn?.actorEntryId === null || !turn) throw new AppError(ErrorCode.FORBIDDEN, "当前没有可操作的 BP 回合。");
    const activeRepresentative = await getRepresentativeUserIdInTx(tx, match.id, turn.actorEntryId);
    if (activeRepresentative !== input.actorId) throw new AppError(ErrorCode.FORBIDDEN, "只有当前队伍指定的 BP 负责人可以操作。");

    if (input.command.kind === "role_select") {
      if (turn.actionType !== "role_select" || session.vetoTeamAEntryId !== null) {
        throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "当前 BP 回合不允许选择 Veto A 队伍。");
      }
      if (!session.turnDeadlineAt || receivedAt > session.turnDeadlineAt) {
        logStaleVetoCommand("deadline");
        return "stale";
      }
      if (input.command.entryId !== match.entryAId && input.command.entryId !== match.entryBId) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, "所选队伍不属于本场比赛。");
      }
      const nextDurationSeconds = roleSelectSuccessorDuration(match, session, input.command.entryId, steps);
      session = await updateSessionInTx(tx, match.id, session, {
        vetoTeamAEntryId: input.command.entryId,
        currentTurnKey: "ban-veto-a-opening",
        turnStartedAt: receivedAt,
        turnDeadlineAt: new Date(receivedAt.getTime() + nextDurationSeconds * 1_000),
      });
      await writeAuditInTx(tx, {
        seasonId: match.seasonId,
        action: "match.veto.role_select",
        actorId: input.actorId,
        targetId: match.id,
        meta: { entryId: input.command.entryId },
      });
      await reconcileVetoSessionInTx(tx, match, session, receivedAt, input.actorId);
      return "applied";
    }

    if (turn.actionType === "role_select" || turn.actionType === "decider") {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "当前 BP 回合不接受地图操作。");
    }
    if (turn.actionType !== input.command.actionType) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "提交的 BP 操作与当前回合不匹配。");
    }
    const deadline = session.turnDeadlineAt;
    if (!deadline || receivedAt > deadline) {
      logStaleVetoCommand("deadline");
      return "stale";
    }
    const pool = session.mapPoolSnapshot ?? [];
    const stepFacts = asStepFacts(steps);
    let mapName: string;
    let side: Side | null = null;
    if (turn.actionType === "side_pick") {
      if (!turn.mapName || (input.command.side !== "ct" && input.command.side !== "t")) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, "请选择该地图的起始方。");
      }
      mapName = turn.mapName;
      side = input.command.side;
    } else {
      if (!input.command.mapName || !pool.includes(input.command.mapName)) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, "请选择冻结地图池中的地图。");
      }
      if (!getEligibleVetoMaps(pool, stepFacts).includes(input.command.mapName)) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, "这张地图已被使用，请选择其他地图。");
      }
      mapName = input.command.mapName;
    }

    const stepOrder = steps.reduce((max, step) => Math.max(max, step.stepOrder), 0) + 1;
    await tx.insert(matchVetoSteps).values({
      matchId: match.id,
      stepOrder,
      actionType: turn.actionType,
      mapName,
      entryId: turn.actorEntryId,
      side,
      source: "participant",
      actorUserId: input.actorId,
      clientRequestId: input.clientRequestId,
      turnKey: turn.key,
      createdAt: receivedAt,
    });

    const afterSteps = await readStepsInTx(tx, match.id);
    const next = currentTurn(match, session, afterSteps);
    let sessionPatch: Partial<VetoSession> = { currentTurnKey: turn.key };
    if (!next) {
      sessionPatch = { currentTurnKey: null, turnStartedAt: null, turnDeadlineAt: null };
    } else if (next.key !== turn.key) {
      sessionPatch = {
        currentTurnKey: next.key,
        turnStartedAt: next.actor === "system" ? null : receivedAt,
        turnDeadlineAt: next.actor === "system" || next.durationSeconds === null
          ? null
          : new Date(receivedAt.getTime() + next.durationSeconds * 1_000),
      };
    }
    session = await updateSessionInTx(tx, match.id, session, sessionPatch);
    await writeAuditInTx(tx, {
      seasonId: match.seasonId,
      action: "match.veto.step",
      actorId: input.actorId,
      targetId: match.id,
      meta: { actionType: turn.actionType, turnKey: turn.key },
    });
    await reconcileVetoSessionInTx(tx, match, session, receivedAt, input.actorId);
    return "applied";
  });
}

export async function pauseVetoRoom(input: { matchId: string; actorId: string; reason: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const match = await lockMatchInTx(tx, input.matchId);
    const session = await getSessionForUpdateInTx(tx, match);
    const now = await databaseNow(tx);
    if (!session.startedAt || session.completedAt || session.pausedAt || match.status !== "in_progress") {
      throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "当前 BP 房间不能暂停。");
    }
    const maps = await tx.select().from(matchMaps).where(eq(matchMaps.matchId, match.id));
    if (maps.some((row) => row.scoreA !== null || row.scoreB !== null || row.completedAt !== null)) {
      throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "已有正式地图比分，不能暂停 BP 房间。");
    }
    const reason = input.reason.trim();
    if (reason.length < 3 || reason.length > 500) throw new AppError(ErrorCode.VALIDATION_FAILED, "请填写 3 至 500 字的暂停原因。");
    await updateSessionInTx(tx, match.id, session, { pausedAt: now, pausedBy: input.actorId, pauseReason: reason });
    await writeAuditInTx(tx, { seasonId: match.seasonId, action: "match.veto.pause", actorId: input.actorId, targetId: match.id, meta: { reason } });
  });
}

export async function resumeVetoRoom(input: { matchId: string; actorId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const match = await lockMatchInTx(tx, input.matchId);
    let session = await getSessionForUpdateInTx(tx, match);
    const now = await databaseNow(tx);
    if (!session.pausedAt || !session.startedAt || session.completedAt || match.status !== "in_progress") {
      throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "当前 BP 房间没有暂停。");
    }
    const pausedAt = session.pausedAt;
    const current = currentTurn(match, session, await readStepsInTx(tx, match.id));
    const duration = current?.durationSeconds;
    const rewoundTurnNeedsFullTime = session.turnDeadlineAt === null && current !== null && current.actor !== "system";
    const resumedStart = rewoundTurnNeedsFullTime ? now : session.turnStartedAt ? new Date(session.turnStartedAt.getTime() + now.getTime() - pausedAt.getTime()) : null;
    const resumedDeadline = rewoundTurnNeedsFullTime && duration !== null && duration !== undefined
      ? new Date(now.getTime() + duration * 1_000)
      : session.turnDeadlineAt ? new Date(session.turnDeadlineAt.getTime() + now.getTime() - pausedAt.getTime()) : null;
    session = await updateSessionInTx(tx, match.id, session, {
      pausedAt: null,
      pausedBy: null,
      pauseReason: null,
      turnStartedAt: resumedStart,
      turnDeadlineAt: resumedDeadline,
    });
    await writeAuditInTx(tx, { seasonId: match.seasonId, action: "match.veto.resume", actorId: input.actorId, targetId: match.id });
    await reconcileVetoSessionInTx(tx, match, session, now, input.actorId);
  });
}

export async function submitVetoAppeal(input: {
  matchId: string;
  incidentId: string;
  actorId: string;
  reason: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const match = await lockMatchInTx(tx, input.matchId);
    const [incident] = await tx.select().from(matchVetoTimeoutIncidents)
      .where(and(eq(matchVetoTimeoutIncidents.id, input.incidentId), eq(matchVetoTimeoutIncidents.matchId, match.id)))
      .for("update");
    const now = await databaseNow(tx);
    if (!incident?.entryId) throw new AppError(ErrorCode.NOT_FOUND, "超时记录不存在。");
    const entryRepresentativeId = await getEntryRepresentativeUserIdInTx(tx, incident.entryId);
    if (incident.representativeUserId !== input.actorId && entryRepresentativeId !== input.actorId) {
      throw new AppError(ErrorCode.FORBIDDEN, "只有超时责任队伍的 BP 负责人或赛事负责人可以申诉。");
    }
    const reason = input.reason.trim();
    if (reason.length < 3 || reason.length > 500) throw new AppError(ErrorCode.VALIDATION_FAILED, "请填写 3 至 500 字的申诉原因。");
    const [pending] = await tx.select({ id: matchVetoAppeals.id })
      .from(matchVetoAppeals)
      .where(and(eq(matchVetoAppeals.timeoutIncidentId, incident.id), eq(matchVetoAppeals.status, "pending")))
      .limit(1);
    if (pending) throw new AppError(ErrorCode.VALIDATION_FAILED, "这条超时记录已有待处理申诉。");
    await tx.insert(matchVetoAppeals).values({ timeoutIncidentId: incident.id, submittedBy: input.actorId, reason, createdAt: now });
    await writeAuditInTx(tx, {
      seasonId: match.seasonId,
      action: "match.veto.appeal_submit",
      actorId: input.actorId,
      targetId: match.id,
      meta: { turnKey: incident.turnKey, entryId: incident.entryId },
    });
  });
}

async function rewindVetoInTx(input: {
  tx: TxDb;
  match: VetoMatch;
  session: VetoSession;
  actorId: string;
  targetTurnKey: string;
  reason: string;
  now: Date;
}): Promise<VetoSession> {
  const { tx, match, session, actorId, targetTurnKey, now } = input;
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) throw new AppError(ErrorCode.VALIDATION_FAILED, "请填写 3 至 500 字的恢复原因。");
  if (!session.startedAt || match.status !== "in_progress") {
    throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "比赛已结束，BP 房间不能恢复。");
  }
  if (targetTurnKey !== "choose-veto-team-a" && !getVetoTurnDefinitions(match.format).some((turn) => turn.key === targetTurnKey)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "指定的 BP 回合不存在。");
  }
  const maps = await tx.select().from(matchMaps).where(eq(matchMaps.matchId, match.id));
  if (maps.some((row) => row.scoreA !== null || row.scoreB !== null || row.completedAt !== null)) {
    throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "已有正式地图比分或 gameplay 结果，BP 房间不能恢复。");
  }
  const steps = await readStepsInTx(tx, match.id);
  const turnOrder = ["choose-veto-team-a", ...getVetoTurnDefinitions(match.format).map((turn) => turn.key)];
  const targetOrder = turnOrder.indexOf(targetTurnKey);
  const removedStepIds = steps.filter((step) => {
    const stepOrder = step.turnKey ? turnOrder.indexOf(step.turnKey) : -1;
    return stepOrder >= targetOrder;
  }).map((step) => step.id);
  if (steps.some((step) => !step.turnKey || !turnOrder.includes(step.turnKey))) {
    throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "发现无法安全解释的历史 BP 步骤，不能执行恢复。");
  }
  const snapshot = {
    session,
    steps,
    maps,
  };
  if (removedStepIds.length > 0) await tx.delete(matchVetoSteps).where(inArray(matchVetoSteps.id, removedStepIds));
  await tx.delete(matchMaps).where(eq(matchMaps.matchId, match.id));
  const rewound = await updateSessionInTx(tx, match.id, session, {
    vetoTeamAEntryId: targetTurnKey === "choose-veto-team-a" ? null : session.vetoTeamAEntryId,
    completedAt: null,
    currentTurnKey: targetTurnKey,
    turnStartedAt: null,
    turnDeadlineAt: null,
    pausedAt: now,
    pausedBy: actorId,
    pauseReason: reason,
  });
  await writeAuditInTx(tx, {
    seasonId: match.seasonId,
    action: "match.veto.rewind",
    actorId,
    targetId: match.id,
    meta: { reason, targetTurnKey, snapshot },
  });
  return rewound;
}

export async function rewindVetoRoom(input: {
  matchId: string;
  actorId: string;
  targetTurnKey: string;
  reason: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const match = await lockMatchInTx(tx, input.matchId);
    const session = await getSessionForUpdateInTx(tx, match);
    const now = await databaseNow(tx);
    await rewindVetoInTx({ tx, match, session, actorId: input.actorId, targetTurnKey: input.targetTurnKey, reason: input.reason, now });
  });
}

export async function resolveVetoAppeal(input: {
  matchId: string;
  appealId: string;
  actorId: string;
  resolutionScope: "platform_or_organizer" | "participant_or_unverified";
  resolutionNote: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const match = await lockMatchInTx(tx, input.matchId);
    const session = await getSessionForUpdateInTx(tx, match);
    const [joined] = await tx.select({ appeal: matchVetoAppeals, incident: matchVetoTimeoutIncidents })
      .from(matchVetoAppeals)
      .innerJoin(matchVetoTimeoutIncidents, eq(matchVetoTimeoutIncidents.id, matchVetoAppeals.timeoutIncidentId))
      .where(and(eq(matchVetoAppeals.id, input.appealId), eq(matchVetoTimeoutIncidents.matchId, match.id)))
      .for("update");
    const now = await databaseNow(tx);
    if (!joined || joined.appeal.status !== "pending") throw new AppError(ErrorCode.NOT_FOUND, "待处理申诉不存在。");
    const note = input.resolutionNote.trim();
    if (note.length < 3 || note.length > 500) throw new AppError(ErrorCode.VALIDATION_FAILED, "请填写 3 至 500 字的裁定说明。");
    const accepted = input.resolutionScope === "platform_or_organizer";
    await tx.update(matchVetoAppeals).set({
      status: accepted ? "accepted" : "rejected",
      resolutionScope: input.resolutionScope,
      resolvedBy: input.actorId,
      resolutionNote: note,
      resolvedAt: now,
    }).where(eq(matchVetoAppeals.id, input.appealId));
    if (accepted) {
      await rewindVetoInTx({
        tx,
        match,
        session,
        actorId: input.actorId,
        targetTurnKey: joined.incident.turnKey,
        reason: note,
        now,
      });
    }
    await writeAuditInTx(tx, {
      seasonId: match.seasonId,
      action: "match.veto.appeal_resolve",
      actorId: input.actorId,
      targetId: match.id,
      meta: { resolutionScope: input.resolutionScope, accepted },
    });
  });
}
