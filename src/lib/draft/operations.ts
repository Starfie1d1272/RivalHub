import "server-only";

import { writeAuditInTx } from "@/lib/audit/write";

import { and, asc, count, eq, isNotNull, lt, sql } from "drizzle-orm";
import { db, type DB, type TxDb } from "@/db/client";
import {
  seasons,
  competitionEntries,
  competitionEntryParticipants,
  competitionEntryRosterMembers,
  competitionEntryRosterRevisions,
  eventRosterMembers,
  eventRosters,
  draftState,
  draftPicks,
  seasonRegistrations,
} from "@/db/schema";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";
import { logEvent } from "@/lib/observability/server";
import { DRAFT_ROUND_TIMEOUT_SECONDS, DRAFT_TOTAL_ROUNDS } from "@/types/draft";
import type { DraftTurnInput, PickPlayerInput, SkipDraftTurnInput } from "@/lib/validators/draft";
import { canPickPosition, getNextEntryId, isStarterRound } from "@/lib/draft/rules";
import {
  createAutoPickRequestId,
  selectAutoPickCandidate,
  type AutoPickCandidate,
} from "@/lib/draft/auto-pick";

interface DraftPickCoreInput {
  seasonId: string;
  entryId: string;
  registrationId: string;
  clientRequestId: string;
  autoPicked: boolean;
  deadlinePolicy: "before-deadline" | "after-deadline";
  captainUserId?: string;
  expectedTurn?: DraftTurnInput;
  now?: Date;
  prefetchedSeason?: typeof seasons.$inferSelect;
  prefetchedDs?: typeof draftState.$inferSelect;
}

interface DraftPickCoreResult {
  pickId: string;
  slug: string;
  idempotent: boolean;
  completed: boolean;
}

interface AutoPickRunResult {
  picked: boolean;
  seasonId: string;
  slug: string;
  pickId?: string;
  completed?: boolean;
  reason?: "draft_not_active" | "not_timed_out" | "no_eligible_player";
}

export interface DraftTimeoutCronSummary {
  processed: number;
  picked: number;
  skipped: number;
}

export async function runDraftTimeoutCron(
  onPicked?: (slug: string) => void,
): Promise<DraftTimeoutCronSummary> {
  const now = new Date();
  const timedOutStates = await db
    .select({ seasonId: draftState.seasonId })
    .from(draftState)
    .where(and(eq(draftState.isActive, true), lt(draftState.roundDeadline, now)));

  let picked = 0;
  let skipped = 0;
  for (const state of timedOutStates) {
    const result = await runAutoPickForSeason(state.seasonId, now);
    if (result.picked) {
      picked += 1;
      onPicked?.(result.slug);
    } else {
      skipped += 1;
      if (result.reason === "no_eligible_player") {
        logEvent({
          level: "warn",
          event: "draft.timeout.manual_skip_required",
          scope: "draft",
          operation: "timeout",
          errorClass: "expected",
          safeContext: { reason: "no_eligible_player", status: "manual_skip_required" },
        });
      }
    }
  }

  return { processed: timedOutStates.length, picked, skipped };
}

export function executeCaptainDraftPick(input: PickPlayerInput & { captainUserId: string }) {
  return db.transaction((tx) =>
    executeDraftPick(tx, {
      ...input,
      entryId: input.expectedTurn.entryId,
      autoPicked: false,
      deadlinePolicy: "before-deadline",
    }),
  );
}

export async function executeDraftSkip({
  seasonId,
  expectedTurn,
  actorId,
  actorEmail,
}: SkipDraftTurnInput & { actorId: string; actorEmail: string }) {
  return db.transaction(async (tx) => {
    const season = await tx.query.seasons.findFirst({
      where: eq(seasons.id, seasonId),
    });
    if (!season) {
      throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);
    }
    if (!season.hasDraft || season.status !== "drafting") {
      throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "赛事当前无法跳过选秀轮次。");
    }

    const ds = await lockDraftState(tx, seasonId);
    if (!ds?.isActive || !ds.currentEntryId) {
      throw new AppError(ErrorCode.DRAFT_NOT_ACTIVE, ERROR_MESSAGES.DRAFT_NOT_ACTIVE);
    }
    assertCurrentDraftTurn(ds, expectedTurn);
    const now = new Date();
    if (!ds.roundDeadline || ds.roundDeadline > now) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "当前轮次尚未超时。");
    }
    if (await findDraftAutoPickCandidate(tx, seasonId, ds.currentEntryId)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "本轮仍有符合条件的选手，请等待自动选人。");
    }

    const next = await advanceDraftTurn(tx, ds, ds.currentEntryId, now, actorId);
    await writeAuditInTx(tx, {
      seasonId,
      action: "draft.skip_turn",
      actorId,
      targetId: ds.id,
      meta: {
        skippedEntryId: ds.currentEntryId,
        round: ds.currentRound,
        ...(next
          ? { nextEntryId: next.entryId, nextRound: next.nextRound }
          : { draftCompleted: true }),
        actorEmail,
      },
    });

    return { slug: season.slug, completed: next === null };
  });
}

async function lockDraftState(tx: TxDb, seasonId: string) {
  const [state] = await tx
    .select()
    .from(draftState)
    .where(eq(draftState.seasonId, seasonId))
    .for("update");
  return state;
}

async function executeDraftPick(tx: TxDb, input: DraftPickCoreInput): Promise<DraftPickCoreResult> {
  const season =
    input.prefetchedSeason ??
    (await tx.query.seasons.findFirst({ where: eq(seasons.id, input.seasonId) }));
  if (!season) {
    throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);
  }
  if (!season.hasDraft) {
    throw new AppError(
      ErrorCode.SEASON_CAPABILITY_DISABLED,
      ERROR_MESSAGES.SEASON_CAPABILITY_DISABLED,
    );
  }
  if (season.status !== "drafting") {
    throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "当前赛事阶段无法选人。");
  }

  const ds = input.prefetchedDs ?? (await lockDraftState(tx, input.seasonId));
  if (!ds) {
    throw new AppError(ErrorCode.DRAFT_NOT_ACTIVE, ERROR_MESSAGES.DRAFT_NOT_ACTIVE);
  }

  const existingByRequestId = await tx.query.draftPicks.findFirst({
    where: eq(draftPicks.clientRequestId, input.clientRequestId),
  });
  if (existingByRequestId) {
    if (
      existingByRequestId.seasonId !== input.seasonId ||
      existingByRequestId.entryId !== input.entryId ||
      existingByRequestId.registrationId !== input.registrationId
    ) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "clientRequestId 已被其他 pick 使用");
    }
    return {
      pickId: existingByRequestId.id,
      slug: season.slug,
      idempotent: true,
      completed: !ds.isActive && !ds.currentEntryId,
    };
  }

  if (!ds.isActive) {
    throw new AppError(ErrorCode.DRAFT_NOT_ACTIVE, ERROR_MESSAGES.DRAFT_NOT_ACTIVE);
  }
  if (ds.currentEntryId !== input.entryId) {
    throw new AppError(ErrorCode.DRAFT_NOT_YOUR_TURN, ERROR_MESSAGES.DRAFT_NOT_YOUR_TURN);
  }
  if (input.expectedTurn) assertCurrentDraftTurn(ds, input.expectedTurn);
  const now = input.now ?? new Date();
  assertDeadline(ds.roundDeadline, input.deadlinePolicy, now);

  const entry = await tx.query.competitionEntries.findFirst({
    where: and(
      eq(competitionEntries.id, input.entryId),
      eq(competitionEntries.competitionId, input.seasonId),
    ),
  });
  if (!entry) {
    throw new AppError(ErrorCode.NOT_FOUND, "参赛者不存在");
  }
  const captainRegistrationId = entry.sourceRegistrationId;
  if (!captainRegistrationId) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "队伍报名队伍不能进入选秀流程");
  }

  const captainRegistration = await tx.query.seasonRegistrations.findFirst({
    where: and(
      eq(seasonRegistrations.id, captainRegistrationId),
      eq(seasonRegistrations.seasonId, input.seasonId),
    ),
  });
  if (
    input.captainUserId &&
    (!captainRegistration || captainRegistration.userId !== input.captainUserId)
  ) {
    throw new AppError(ErrorCode.FORBIDDEN, "只有当前轮次队长可以选择选手");
  }
  if (input.registrationId === captainRegistrationId) {
    throw new AppError(ErrorCode.PLAYER_ALREADY_PICKED, "队长已在该队伍中");
  }

  const targetRegistration = await tx.query.seasonRegistrations.findFirst({
    where: and(
      eq(seasonRegistrations.id, input.registrationId),
      eq(seasonRegistrations.seasonId, input.seasonId),
    ),
  });
  if (!targetRegistration) {
    throw new AppError(ErrorCode.NOT_FOUND, "目标选手不存在");
  }
  if (targetRegistration.status !== "approved") {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "只能选择已通过审核的选手");
  }

  const existingPick = await tx.query.draftPicks.findFirst({
    where: and(
      eq(draftPicks.seasonId, input.seasonId),
      eq(draftPicks.registrationId, input.registrationId),
    ),
  });
  if (existingPick) {
    throw new AppError(ErrorCode.PLAYER_ALREADY_PICKED, ERROR_MESSAGES.PLAYER_ALREADY_PICKED);
  }

  const [positionCount] = await tx
    .select({ count: count() })
    .from(eventRosterMembers)
    .innerJoin(eventRosters, eq(eventRosterMembers.eventRosterId, eventRosters.id))
    .innerJoin(
      seasonRegistrations,
      and(
        eq(eventRosterMembers.userId, seasonRegistrations.userId),
        eq(seasonRegistrations.seasonId, input.seasonId),
      ),
    )
    .where(
      and(
        eq(eventRosters.entryId, input.entryId),
        eq(eventRosterMembers.isCurrent, true),
        eq(seasonRegistrations.primaryPosition, targetRegistration.primaryPosition),
      ),
    );
  if (!canPickPosition(Number(positionCount?.count ?? 0))) {
    throw new AppError(
      ErrorCode.TEAM_POSITION_CAP_EXCEEDED,
      ERROR_MESSAGES.TEAM_POSITION_CAP_EXCEEDED,
    );
  }

  const [pickCount] = await tx
    .select({ count: count() })
    .from(draftPicks)
    .where(eq(draftPicks.seasonId, input.seasonId));
  const pickNumber = Number(pickCount?.count ?? 0) + 1;

  const [pick] = await tx
    .insert(draftPicks)
    .values({
      seasonId: input.seasonId,
      entryId: input.entryId,
      registrationId: input.registrationId,
      round: ds.currentRound,
      pickNumber,
      autoPicked: input.autoPicked,
      clientRequestId: input.clientRequestId,
    })
    .returning({ id: draftPicks.id });

  const [participant] = await tx
    .insert(competitionEntryParticipants)
    .values({
      entryId: input.entryId,
      userId: targetRegistration.userId,
      status: "confirmed",
      confirmedAt: now,
      invitedByUserId: entry.representativeUserId,
    })
    .returning({ id: competitionEntryParticipants.id });
  const [roster] = await tx
    .select({ id: eventRosters.id })
    .from(eventRosters)
    .where(eq(eventRosters.entryId, input.entryId))
    .for("update");
  const [revision] = await tx
    .select({ id: competitionEntryRosterRevisions.id })
    .from(competitionEntryRosterRevisions)
    .where(
      and(
        eq(competitionEntryRosterRevisions.entryId, input.entryId),
        eq(competitionEntryRosterRevisions.id, entry.currentRosterRevisionId),
      ),
    )
    .for("update");
  if (!roster || !revision)
    throw new AppError(ErrorCode.INTERNAL_ERROR, "选秀参赛者缺少 roster owner。");
  await tx.insert(competitionEntryRosterMembers).values({
    revisionId: revision.id,
    participantId: participant.id,
    userId: targetRegistration.userId,
    isPrimaryStarter: isStarterRound(ds.currentRound),
  });
  await tx.insert(eventRosterMembers).values({
    eventRosterId: roster.id,
    participantId: participant.id,
    userId: targetRegistration.userId,
    isPrimaryStarter: isStarterRound(ds.currentRound),
  });

  await writeAuditInTx(tx, {
    seasonId: input.seasonId,
    action: "draft.pick",
    actorId: input.captainUserId ?? "system:auto-pick",
    targetId: pick.id,
    meta: {
      entryId: input.entryId,
      registrationId: input.registrationId,
      round: ds.currentRound,
      pickNumber,
      autoPicked: input.autoPicked,
    },
  });

  const next = await advanceDraftTurn(
    tx,
    ds,
    input.entryId,
    now,
    input.captainUserId ?? "system:draft",
  );
  return { pickId: pick.id, slug: season.slug, idempotent: false, completed: next === null };
}

async function advanceDraftTurn(
  tx: TxDb,
  state: typeof draftState.$inferSelect,
  entryId: string,
  now: Date,
  actorId: string,
) {
  const seasonTeams = await tx
    .select({
      id: competitionEntries.id,
      draftOrder: sql<number>`${competitionEntries.formationOrder}`.as("draft_order"),
    })
    .from(competitionEntries)
    .where(
      and(
        eq(competitionEntries.competitionId, state.seasonId),
        isNotNull(competitionEntries.formationOrder),
      ),
    )
    .orderBy(asc(competitionEntries.formationOrder));
  const next = getNextEntryId(seasonTeams, entryId, state.currentRound);

  if (!next) {
    await finalizeDraft(tx, {
      seasonId: state.seasonId,
      draftStateId: state.id,
      now,
      actorId,
    });

    return null;
  }

  const deadline = new Date(now.getTime() + DRAFT_ROUND_TIMEOUT_SECONDS * 1000);
  await tx
    .update(draftState)
    .set({
      currentRound: next.nextRound,
      currentEntryId: next.entryId,
      roundDeadline: deadline,
      isActive: true,
      updatedAt: now,
    })
    .where(eq(draftState.id, state.id));

  return next;
}

async function finalizeDraft(
  tx: TxDb,
  input: { seasonId: string; draftStateId: string; now: Date; actorId: string },
): Promise<void> {
  await tx
    .update(draftState)
    .set({
      currentRound: DRAFT_TOTAL_ROUNDS + 1,
      currentEntryId: null,
      roundDeadline: null,
      isActive: false,
      updatedAt: input.now,
    })
    .where(eq(draftState.id, input.draftStateId));
  await tx
    .update(seasons)
    .set({ status: "playing", updatedAt: input.now })
    .where(eq(seasons.id, input.seasonId));
  await tx
    .update(eventRosters)
    .set({
      sourceRosterRevisionId: sql`(SELECT entry.current_roster_revision_id FROM competition_entries entry WHERE entry.id = ${eventRosters.entryId})`,
      status: "frozen",
      confirmedAt: input.now,
      confirmedBy: input.actorId,
      frozenAt: input.now,
      frozenBy: input.actorId,
      updatedAt: input.now,
    })
    .where(
      sql`${eventRosters.entryId} IN (SELECT ${competitionEntries.id} FROM ${competitionEntries} WHERE ${competitionEntries.competitionId} = ${input.seasonId})`,
    );
  await tx
    .update(competitionEntryRosterRevisions)
    .set({ status: "approved", submittedAt: input.now, approvedAt: input.now })
    .where(
      sql`${competitionEntryRosterRevisions.entryId} IN (SELECT ${competitionEntries.id} FROM ${competitionEntries} WHERE ${competitionEntries.competitionId} = ${input.seasonId}) AND ${competitionEntryRosterRevisions.id} = (SELECT entry.current_roster_revision_id FROM competition_entries entry WHERE entry.id = ${competitionEntryRosterRevisions.entryId})`,
    );
  await tx
    .update(competitionEntries)
    .set({
      approvedRosterRevisionId: competitionEntries.currentRosterRevisionId,
      updatedAt: input.now,
    })
    .where(eq(competitionEntries.competitionId, input.seasonId));
}

async function runAutoPickForSeason(
  seasonId: string,
  now = new Date(),
): Promise<AutoPickRunResult> {
  return db.transaction(async (tx) => {
    const season = await tx.query.seasons.findFirst({
      where: eq(seasons.id, seasonId),
    });
    if (!season) {
      throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);
    }

    const ds = await lockDraftState(tx, seasonId);

    if (!ds?.isActive || !ds.currentEntryId) {
      return { picked: false, seasonId, slug: season.slug, reason: "draft_not_active" };
    }
    if (!ds.roundDeadline || ds.roundDeadline.getTime() > now.getTime()) {
      return { picked: false, seasonId, slug: season.slug, reason: "not_timed_out" };
    }

    const selected = await findDraftAutoPickCandidate(tx, seasonId, ds.currentEntryId);
    if (!selected) {
      return { picked: false, seasonId, slug: season.slug, reason: "no_eligible_player" };
    }

    const pick = await executeDraftPick(tx, {
      seasonId,
      entryId: ds.currentEntryId,
      registrationId: selected.registrationId,
      clientRequestId: createAutoPickRequestId({
        seasonId,
        entryId: ds.currentEntryId,
        round: ds.currentRound,
        deadline: ds.roundDeadline,
      }),
      autoPicked: true,
      deadlinePolicy: "after-deadline",
      now,
      prefetchedSeason: season,
      prefetchedDs: ds,
    });

    return {
      picked: true,
      seasonId,
      slug: pick.slug,
      pickId: pick.pickId,
      completed: pick.completed,
    };
  });
}

function assertCurrentDraftTurn(
  state: Pick<typeof draftState.$inferSelect, "currentEntryId" | "currentRound" | "roundDeadline">,
  expected: DraftTurnInput,
) {
  if (
    state.currentEntryId !== expected.entryId ||
    state.currentRound !== expected.round ||
    state.roundDeadline?.toISOString() !== expected.deadline
  ) {
    throw new AppError(ErrorCode.DRAFT_NOT_YOUR_TURN, "选秀轮次或截止时间已变化，请刷新状态。");
  }
}

function assertDeadline(
  deadline: Date | null,
  policy: DraftPickCoreInput["deadlinePolicy"],
  now: Date,
) {
  if (!deadline) {
    throw new AppError(ErrorCode.DRAFT_DEADLINE_PASSED, ERROR_MESSAGES.DRAFT_DEADLINE_PASSED);
  }
  if (policy === "before-deadline" && deadline.getTime() <= now.getTime()) {
    throw new AppError(ErrorCode.DRAFT_DEADLINE_PASSED, ERROR_MESSAGES.DRAFT_DEADLINE_PASSED);
  }
  if (policy === "after-deadline" && deadline.getTime() > now.getTime()) {
    throw new AppError(ErrorCode.DRAFT_DEADLINE_PASSED, "当前轮次尚未超时");
  }
}

export async function findDraftAutoPickCandidate(
  executor: Pick<DB, "select">,
  seasonId: string,
  entryId: string,
) {
  const positionCounts = await getTeamPositionCounts(executor, entryId);
  const candidates = await getAutoPickCandidates(executor, seasonId);
  return selectAutoPickCandidate(candidates, positionCounts);
}

async function getTeamPositionCounts(
  tx: Pick<DB, "select">,
  entryId: string,
): Promise<Record<string, number>> {
  const rows = await tx
    .select({
      primaryPosition: seasonRegistrations.primaryPosition,
      count: count(),
    })
    .from(eventRosterMembers)
    .innerJoin(eventRosters, eq(eventRosterMembers.eventRosterId, eventRosters.id))
    .innerJoin(
      seasonRegistrations,
      and(
        eq(eventRosterMembers.userId, seasonRegistrations.userId),
        eq(
          seasonRegistrations.seasonId,
          sql`(SELECT competition_id FROM competition_entries WHERE id = ${entryId})`,
        ),
      ),
    )
    .where(and(eq(eventRosters.entryId, entryId), eq(eventRosterMembers.isCurrent, true)))
    .groupBy(seasonRegistrations.primaryPosition);

  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.primaryPosition] = Number(row.count);
  }
  return counts;
}

async function getAutoPickCandidates(
  tx: Pick<DB, "select">,
  seasonId: string,
): Promise<AutoPickCandidate[]> {
  const captainRows = await tx
    .select({ registrationId: competitionEntries.sourceRegistrationId })
    .from(competitionEntries)
    .where(eq(competitionEntries.competitionId, seasonId));
  const pickRows = await tx
    .select({ registrationId: draftPicks.registrationId })
    .from(draftPicks)
    .where(eq(draftPicks.seasonId, seasonId));
  const excluded = new Set([
    ...captainRows.map((row) => row.registrationId),
    ...pickRows.map((row) => row.registrationId),
  ]);

  const candidates = await tx
    .select({
      registrationId: seasonRegistrations.id,
      primaryPosition: seasonRegistrations.primaryPosition,
      peakRating: seasonRegistrations.peakRating,
      peakRank: seasonRegistrations.peakRank,
      currentRank: seasonRegistrations.currentSeasonPeakRank,
      currentRating: seasonRegistrations.currentRating,
      createdAt: seasonRegistrations.createdAt,
    })
    .from(seasonRegistrations)
    .where(
      and(eq(seasonRegistrations.seasonId, seasonId), eq(seasonRegistrations.status, "approved")),
    );

  return candidates
    .filter((candidate) => !excluded.has(candidate.registrationId))
    .map((candidate) => ({
      registrationId: candidate.registrationId,
      primaryPosition: candidate.primaryPosition,
      peakRating: candidate.peakRating,
      peakRank: candidate.peakRank,
      currentRank: candidate.currentRank,
      currentRating: candidate.currentRating,
      createdAt: candidate.createdAt,
    }));
}
