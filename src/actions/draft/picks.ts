"use server";

import { and, asc, count, eq, lt } from "drizzle-orm";
import { db } from "@/db/client";
import {
  seasons,
  teams,
  draftState,
  draftPicks,
  teamMembers,
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
  autoPickSchema,
  skipDraftTurnSchema,
  type PickPlayerInput,
  type AutoPickInput,
  type SkipDraftTurnInput,
} from "@/lib/validators/draft";
import { DRAFT_ROUND_TIMEOUT_SECONDS, DRAFT_TOTAL_ROUNDS } from "@/types/draft";
import { canPickPosition, getNextTeamId, isStarterRound } from "@/lib/draft/rules";
import {
  createAutoPickRequestId,
  selectAutoPickCandidate,
  type AutoPickCandidate,
} from "@/lib/draft/auto-pick";

type DraftTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface DraftPickCoreInput {
  seasonId: string;
  teamId: string;
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

  const { seasonId, teamId, registrationId, clientRequestId } = parsed.data;

  try {
    const user = await requireAuth();
    const result = await db.transaction(async (tx) => {
      return executeDraftPick(tx, {
        seasonId,
        teamId,
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

// ── 超时自动选择 ───────────────────────────────────────────

export async function autoPick(
  input: AutoPickInput,
): Promise<ActionResult<{ picked: boolean; pickId?: string; completed?: boolean; reason?: string }>> {
  const parsed = autoPickSchema.safeParse(input);
  if (!parsed.success) {
    return failValidation("自动选择参数无效");
  }

  try {
    await requireSeasonAdmin(parsed.data.seasonId);
    const result = await runAutoPickForSeason(parsed.data.seasonId);
    if (result.picked) {
      revalidateDraftPaths(result.slug);
    }
    return ok({
      picked: result.picked,
      pickId: result.pickId,
      completed: result.completed,
      reason: result.reason,
    });
  } catch (e) {
    return actionError("autoPick", e);
  }
}

// ── 管理员强制跳过当前轮次（用于无可选选手时解除卡死）───────────────────────────────────────

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

      if (!ds?.isActive || !ds.currentTeamId) {
        throw new AppError(ErrorCode.DRAFT_NOT_ACTIVE, ERROR_MESSAGES.DRAFT_NOT_ACTIVE);
      }

      const seasonTeams = await tx
        .select({ id: teams.id, draftOrder: teams.draftOrder })
        .from(teams)
        .where(eq(teams.seasonId, parsed.data.seasonId))
        .orderBy(asc(teams.draftOrder));

      const skippedTeamId = ds.currentTeamId;
      const skippedRound = ds.currentRound;
      const next = getNextTeamId(seasonTeams, ds.currentTeamId, ds.currentRound);
      const now = new Date();

      if (!next) {
        await tx
          .update(draftState)
          .set({
            currentRound: DRAFT_TOTAL_ROUNDS + 1,
            currentTeamId: null,
            roundDeadline: null,
            isActive: false,
            updatedAt: now,
          })
          .where(eq(draftState.id, ds.id));
        await tx
          .update(seasons)
          .set({ status: "playing", updatedAt: now })
          .where(eq(seasons.id, parsed.data.seasonId));

        await tx.insert(auditLogs).values({
          seasonId: parsed.data.seasonId,
          action: "draft.skip_turn",
          actorId: auditActorId(admin),
          targetId: ds.id,
          targetType: "draft_state",
          meta: { skippedTeamId, round: skippedRound, draftCompleted: true, actorEmail: admin.email },
        });

        return { slug: season.slug, completed: true };
      }

      const deadline = new Date(now.getTime() + DRAFT_ROUND_TIMEOUT_SECONDS * 1000);
      await tx
        .update(draftState)
        .set({
          currentRound: next.nextRound,
          currentTeamId: next.teamId,
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
          skippedTeamId,
          round: skippedRound,
          nextTeamId: next.teamId,
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
      revalidateDraftPaths(result.slug);
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

    if (!ds?.isActive || !ds.currentTeamId) {
      return { picked: false, seasonId, slug: season.slug, reason: "draft_not_active" };
    }
    if (!ds.roundDeadline || ds.roundDeadline.getTime() > now.getTime()) {
      return { picked: false, seasonId, slug: season.slug, reason: "not_timed_out" };
    }

    const positionCounts = await getTeamPositionCounts(tx, ds.currentTeamId);
    const candidates = await getAutoPickCandidates(tx, seasonId);
    const selected = selectAutoPickCandidate(candidates, positionCounts);
    if (!selected) {
      return { picked: false, seasonId, slug: season.slug, reason: "no_eligible_player" };
    }

    const pick = await executeDraftPick(tx, {
      seasonId,
      teamId: ds.currentTeamId,
      registrationId: selected.registrationId,
      clientRequestId: createAutoPickRequestId({
        seasonId,
        teamId: ds.currentTeamId,
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
      existingByRequestId.teamId !== input.teamId ||
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
      completed: !ds.isActive && !ds.currentTeamId,
    };
  }

  if (!ds.isActive) {
    throw new AppError(ErrorCode.DRAFT_NOT_ACTIVE, ERROR_MESSAGES.DRAFT_NOT_ACTIVE);
  }
  if (ds.currentTeamId !== input.teamId) {
    throw new AppError(ErrorCode.DRAFT_NOT_YOUR_TURN, ERROR_MESSAGES.DRAFT_NOT_YOUR_TURN);
  }
  assertDeadline(ds.roundDeadline, input.deadlinePolicy, now);

  const team = await tx.query.teams.findFirst({
    where: and(eq(teams.id, input.teamId), eq(teams.seasonId, input.seasonId)),
  });
  if (!team) {
    throw new AppError(ErrorCode.NOT_FOUND, "队伍不存在");
  }

  const captainRegistration = await tx.query.seasonRegistrations.findFirst({
    where: and(
      eq(seasonRegistrations.id, team.captainRegistrationId),
      eq(seasonRegistrations.seasonId, input.seasonId),
    ),
  });
  if (
    input.captainUserId &&
    (!captainRegistration || captainRegistration.userId !== input.captainUserId)
  ) {
    throw new AppError(ErrorCode.FORBIDDEN, "只有当前轮次队长可以选择选手");
  }
  if (input.registrationId === team.captainRegistrationId) {
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
    .from(teamMembers)
    .innerJoin(
      seasonRegistrations,
      eq(teamMembers.registrationId, seasonRegistrations.id),
    )
    .where(
      and(
        eq(teamMembers.teamId, input.teamId),
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
      teamId: input.teamId,
      registrationId: input.registrationId,
      round: ds.currentRound,
      pickNumber,
      autoPicked: input.autoPicked,
      clientRequestId: input.clientRequestId,
    })
    .returning({ id: draftPicks.id });

  await tx.insert(teamMembers).values({
    teamId: input.teamId,
    registrationId: input.registrationId,
    isStarter: isStarterRound(ds.currentRound),
  });

  await tx.insert(auditLogs).values({
    seasonId: input.seasonId,
    action: "draft.pick",
    actorId: input.captainUserId ?? "system:auto-pick",
    targetId: pick.id,
    targetType: "draft_pick",
    meta: {
      teamId: input.teamId,
      registrationId: input.registrationId,
      round: ds.currentRound,
      pickNumber,
      autoPicked: input.autoPicked,
    },
  });

  const seasonTeams = await tx
    .select({ id: teams.id, draftOrder: teams.draftOrder })
    .from(teams)
    .where(eq(teams.seasonId, input.seasonId))
    .orderBy(asc(teams.draftOrder));
  const next = getNextTeamId(seasonTeams, input.teamId, ds.currentRound);

  if (!next) {
    await tx
      .update(draftState)
      .set({
        currentRound: DRAFT_TOTAL_ROUNDS + 1,
        currentTeamId: null,
        roundDeadline: null,
        isActive: false,
        updatedAt: now,
      })
      .where(eq(draftState.id, ds.id));
    await tx
      .update(seasons)
      .set({ status: "playing", updatedAt: now })
      .where(eq(seasons.id, input.seasonId));

    return { pickId: pick.id, slug: season.slug, idempotent: false, completed: true };
  }

  const deadline = new Date(now.getTime() + DRAFT_ROUND_TIMEOUT_SECONDS * 1000);
  await tx
    .update(draftState)
    .set({
      currentRound: next.nextRound,
      currentTeamId: next.teamId,
      roundDeadline: deadline,
      isActive: true,
      updatedAt: now,
    })
    .where(eq(draftState.id, ds.id));

  return { pickId: pick.id, slug: season.slug, idempotent: false, completed: false };
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
  teamId: string,
): Promise<Record<string, number>> {
  const rows = await tx
    .select({
      primaryPosition: seasonRegistrations.primaryPosition,
      count: count(),
    })
    .from(teamMembers)
    .innerJoin(
      seasonRegistrations,
      eq(teamMembers.registrationId, seasonRegistrations.id),
    )
    .where(eq(teamMembers.teamId, teamId))
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
    .select({ registrationId: teams.captainRegistrationId })
    .from(teams)
    .where(eq(teams.seasonId, seasonId));
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

function revalidateDraftPaths(slug: string) {
  revalidateSeasonPaths(slug, ["draft", "draftCaptain", "teams", "adminDraft"]);
}
