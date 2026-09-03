"use server";

import { and, asc, count, eq, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
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
  auditLogs,
} from "@/db/schema";
import { ok, type ActionResult } from "@/types/action";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";
import { auditActorId, requireAuth, requireSeasonAdmin } from "@/lib/auth/session";
import { failValidation, actionError } from "@/lib/action-utils";
import { revalidateSeasonPaths } from "@/lib/revalidation";
import {
  pickPlayerSchema,
  skipDraftTurnSchema,
  type PickPlayerInput,
  type SkipDraftTurnInput,
} from "@/lib/validators/draft";
import { DRAFT_ROUND_TIMEOUT_SECONDS, DRAFT_TOTAL_ROUNDS } from "@/types/draft";
import { canPickPosition, getNextEntryId, isStarterRound } from "@/lib/draft/rules";
import {
  createAutoPickRequestId,
  selectAutoPickCandidate,
  type AutoPickCandidate,
} from "@/lib/draft/auto-pick";

type DraftTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface DraftPickCoreInput {
  seasonId: string;
  entryId: string;
  registrationId: string;
  clientRequestId: string;
  autoPicked: boolean;
  deadlinePolicy: "before-deadline" | "after-deadline";
  captainUserId?: string;
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

// ── 队长选择选手 ───────────────────────────────────────────

export async function pickPlayer(
  input: PickPlayerInput,
): Promise<ActionResult<{ pickId: string; idempotent: boolean; completed: boolean }>> {
  const parsed = pickPlayerSchema.safeParse(input);
  if (!parsed.success) {
    return failValidation("选择选手参数无效");
  }

  const { seasonId, entryId, registrationId, clientRequestId } = parsed.data;

  try {
    const user = await requireAuth();
    const result = await db.transaction(async (tx) => {
      return executeDraftPick(tx, {
        seasonId,
        entryId,
        registrationId,
        clientRequestId,
        autoPicked: false,
        deadlinePolicy: "before-deadline",
        captainUserId: user.userId,
      });
    });

    revalidateSeasonPaths(result.slug, ["draft", "draftCaptain", "teams", "adminDraft"]);
    return ok({
      pickId: result.pickId,
      idempotent: result.idempotent,
      completed: result.completed,
    });
  } catch (e) {
    return actionError("pickPlayer", e);
  }
}

/**
 * Operator-only recovery path for the rare timeout state with no eligible
 * candidate. It is intentionally retained even when static callers are absent:
 * the timeout cron reports this action as the manual remediation.
 */
export async function skipDraftTurn(
  input: SkipDraftTurnInput,
): Promise<ActionResult<{ skipped: boolean; completed: boolean }>> {
  const parsed = skipDraftTurnSchema.safeParse(input);
  if (!parsed.success) {
    return failValidation("跳过轮次参数无效");
  }
  const admin = await requireSeasonAdmin(parsed.data.seasonId);

  try {
    const result = await db.transaction(async (tx) => {
      const season = await tx.query.seasons.findFirst({
        where: eq(seasons.id, parsed.data.seasonId),
      });
      if (!season) {
        throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);
      }
      if (season.status !== "drafting") {
        throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "只有 drafting 状态的赛季可以跳过轮次");
      }

      const [ds] = await tx
        .select()
        .from(draftState)
        .where(eq(draftState.seasonId, parsed.data.seasonId))
        .for("update");

      if (!ds?.isActive || !ds.currentEntryId) {
        throw new AppError(ErrorCode.DRAFT_NOT_ACTIVE, ERROR_MESSAGES.DRAFT_NOT_ACTIVE);
      }

      const seasonTeams = await tx
        .select({ id: competitionEntries.id, draftOrder: sql<number>`${competitionEntries.formationOrder}`.as("draft_order") })
        .from(competitionEntries)
        .where(and(eq(competitionEntries.competitionId, parsed.data.seasonId), isNotNull(competitionEntries.formationOrder)))
        .orderBy(asc(competitionEntries.formationOrder));

      const skippedEntryId = ds.currentEntryId;
      const skippedRound = ds.currentRound;
      const next = getNextEntryId(seasonTeams, ds.currentEntryId, ds.currentRound);
      const now = new Date();

      if (!next) {
        await finalizeDraft(tx, {
          seasonId: parsed.data.seasonId,
          draftStateId: ds.id,
          now,
          actorId: auditActorId(admin),
        });

        await tx.insert(auditLogs).values({
          seasonId: parsed.data.seasonId,
          action: "draft.skip_turn",
          actorId: auditActorId(admin),
          targetId: ds.id,
          targetType: "draft_state",
          meta: { skippedEntryId, round: skippedRound, draftCompleted: true, actorEmail: admin.email },
        });

        return { slug: season.slug, completed: true };
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
        .where(eq(draftState.id, ds.id));

      await tx.insert(auditLogs).values({
        seasonId: parsed.data.seasonId,
        action: "draft.skip_turn",
        actorId: auditActorId(admin),
        targetId: ds.id,
        targetType: "draft_state",
        meta: {
          skippedEntryId,
          round: skippedRound,
          nextEntryId: next.entryId,
          nextRound: next.nextRound,
          actorEmail: admin.email,
        },
      });

      return { slug: season.slug, completed: false };
    });

    revalidateDraftPaths(result.slug);
    return ok({ skipped: true, completed: result.completed });
  } catch (e) {
    return actionError("skipDraftTurn", e);
  }
}

export async function runDraftTimeoutCron(): Promise<DraftTimeoutCronSummary> {
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
      revalidateDraftPaths(result.slug, "route");
    } else {
      skipped += 1;
      if (result.reason === "no_eligible_player") {
        console.warn(
          `[draft-timeout-cron] season ${state.seasonId}: no eligible player, manual skip required (admin → draft.skip_turn)`,
        );
      }
    }
  }

  return { processed: timedOutStates.length, picked, skipped };
}

// ── 内部函数 ───────────────────────────────────────────

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

    const [ds] = await tx
      .select()
      .from(draftState)
      .where(eq(draftState.seasonId, seasonId))
      .for("update");

    if (!ds?.isActive || !ds.currentEntryId) {
      return { picked: false, seasonId, slug: season.slug, reason: "draft_not_active" };
    }
    if (!ds.roundDeadline || ds.roundDeadline.getTime() > now.getTime()) {
      return { picked: false, seasonId, slug: season.slug, reason: "not_timed_out" };
    }

    const positionCounts = await getTeamPositionCounts(tx, ds.currentEntryId);
    const candidates = await getAutoPickCandidates(tx, seasonId);
    const selected = selectAutoPickCandidate(candidates, positionCounts);
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

async function executeDraftPick(
  tx: DraftTransaction,
  input: DraftPickCoreInput,
): Promise<DraftPickCoreResult> {
  const now = input.now ?? new Date();

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
    throw new AppError(
      ErrorCode.SEASON_INVALID_STATUS,
      "只有 drafting 状态的赛季可以进行选秀",
    );
  }

  // 如果调用方已持有 FOR UPDATE 锁（同一事务内），直接复用，避免重复 round trip
  const ds =
    input.prefetchedDs ??
    (await tx.select().from(draftState).where(eq(draftState.seasonId, input.seasonId)).for("update"))[0];
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
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        "clientRequestId 已被其他 pick 使用",
      );
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
  assertDeadline(ds.roundDeadline, input.deadlinePolicy, now);

  const entry = await tx.query.competitionEntries.findFirst({
    where: and(eq(competitionEntries.id, input.entryId), eq(competitionEntries.competitionId, input.seasonId)),
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
    throw new AppError(
      ErrorCode.PLAYER_ALREADY_PICKED,
      ERROR_MESSAGES.PLAYER_ALREADY_PICKED,
    );
  }

  const [positionCount] = await tx
    .select({ count: count() })
    .from(eventRosterMembers)
    .innerJoin(eventRosters, eq(eventRosterMembers.eventRosterId, eventRosters.id))
    .innerJoin(seasonRegistrations, and(
      eq(eventRosterMembers.userId, seasonRegistrations.userId),
      eq(seasonRegistrations.seasonId, input.seasonId),
    ))
    .where(
      and(
        eq(eventRosters.entryId, input.entryId),
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

  const [participant] = await tx.insert(competitionEntryParticipants).values({
    entryId: input.entryId,
    userId: targetRegistration.userId,
    status: "confirmed",
    confirmedAt: now,
    invitedByUserId: entry.representativeUserId,
  }).returning({ id: competitionEntryParticipants.id });
  const [roster] = await tx.select({ id: eventRosters.id }).from(eventRosters)
    .where(eq(eventRosters.entryId, input.entryId)).for("update");
  const [revision] = await tx.select({ id: competitionEntryRosterRevisions.id }).from(competitionEntryRosterRevisions)
    .where(and(eq(competitionEntryRosterRevisions.entryId, input.entryId), eq(competitionEntryRosterRevisions.id, entry.currentRosterRevisionId))).for("update");
  if (!roster || !revision) throw new AppError(ErrorCode.INTERNAL_ERROR, "选秀参赛者缺少 roster owner。");
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

  await tx.insert(auditLogs).values({
    seasonId: input.seasonId,
    action: "draft.pick",
    actorId: input.captainUserId ?? "system:auto-pick",
    targetId: pick.id,
    targetType: "draft_pick",
    meta: {
      entryId: input.entryId,
      registrationId: input.registrationId,
      round: ds.currentRound,
      pickNumber,
      autoPicked: input.autoPicked,
    },
  });

  const seasonTeams = await tx
    .select({ id: competitionEntries.id, draftOrder: sql<number>`${competitionEntries.formationOrder}`.as("draft_order") })
    .from(competitionEntries)
    .where(and(eq(competitionEntries.competitionId, input.seasonId), isNotNull(competitionEntries.formationOrder)))
    .orderBy(asc(competitionEntries.formationOrder));
  const next = getNextEntryId(seasonTeams, input.entryId, ds.currentRound);

  if (!next) {
    await finalizeDraft(tx, {
      seasonId: input.seasonId,
      draftStateId: ds.id,
      now,
      actorId: input.captainUserId ?? "system:draft",
    });

    return { pickId: pick.id, slug: season.slug, idempotent: false, completed: true };
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
    .where(eq(draftState.id, ds.id));

  return { pickId: pick.id, slug: season.slug, idempotent: false, completed: false };
}

async function finalizeDraft(
  tx: DraftTransaction,
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
    .where(sql`${eventRosters.entryId} IN (SELECT ${competitionEntries.id} FROM ${competitionEntries} WHERE ${competitionEntries.competitionId} = ${input.seasonId})`);
  await tx
    .update(competitionEntryRosterRevisions)
    .set({ status: "approved", submittedAt: input.now, approvedAt: input.now })
    .where(sql`${competitionEntryRosterRevisions.entryId} IN (SELECT ${competitionEntries.id} FROM ${competitionEntries} WHERE ${competitionEntries.competitionId} = ${input.seasonId}) AND ${competitionEntryRosterRevisions.id} = (SELECT entry.current_roster_revision_id FROM competition_entries entry WHERE entry.id = ${competitionEntryRosterRevisions.entryId})`);
  await tx
    .update(competitionEntries)
    .set({ approvedRosterRevisionId: competitionEntries.currentRosterRevisionId, updatedAt: input.now })
    .where(eq(competitionEntries.competitionId, input.seasonId));
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

async function getTeamPositionCounts(
  tx: DraftTransaction,
  entryId: string,
): Promise<Record<string, number>> {
  const rows = await tx
    .select({
      primaryPosition: seasonRegistrations.primaryPosition,
      count: count(),
    })
    .from(eventRosterMembers)
    .innerJoin(eventRosters, eq(eventRosterMembers.eventRosterId, eventRosters.id))
    .innerJoin(seasonRegistrations, and(
      eq(eventRosterMembers.userId, seasonRegistrations.userId),
      eq(seasonRegistrations.seasonId, sql`(SELECT competition_id FROM competition_entries WHERE id = ${entryId})`),
    ))
    .where(eq(eventRosters.entryId, entryId))
    .groupBy(seasonRegistrations.primaryPosition);

  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.primaryPosition] = Number(row.count);
  }
  return counts;
}

async function getAutoPickCandidates(
  tx: DraftTransaction,
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
      and(
        eq(seasonRegistrations.seasonId, seasonId),
        eq(seasonRegistrations.status, "approved"),
      ),
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

function revalidateDraftPaths(slug: string, mode: "action" | "route" = "action") {
  revalidateSeasonPaths(slug, ["draft", "draftCaptain", "teams", "adminDraft"], { mode });
}
