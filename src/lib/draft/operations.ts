import "server-only";

import { writeAuditInTx } from "@/lib/audit/write";

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
  } from "@/db/schema";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";
import { logEvent } from "@/lib/observability/server";
import { canPickPosition, draftFormat, getNextEntryId, isStarterRound } from "@/lib/draft/rules";
import { decodeSeasonRules } from "@/lib/seasons/rules";
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

export async function executeDraftPick(
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
  const rules = decodeSeasonRules(season);
  const format = draftFormat(rules);
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

  // The draft-state row is locked above, serializing picks for this season.
  // Check the actual roster as well as draft_picks: captains and manually
  // assembled members do not necessarily have a pick record.
  const [occupied] = await tx.select({ id: eventRosterMembers.id })
    .from(eventRosterMembers)
    .innerJoin(eventRosters, eq(eventRosterMembers.eventRosterId, eventRosters.id))
    .innerJoin(competitionEntries, eq(eventRosters.entryId, competitionEntries.id))
    .where(and(
      eq(competitionEntries.competitionId, input.seasonId),
      eq(eventRosterMembers.userId, targetRegistration.userId),
      eq(eventRosterMembers.isCurrent, true),
    )).limit(1);
  if (occupied) {
    throw new AppError(ErrorCode.PLAYER_ALREADY_PICKED, "选手已在赛事名单中");
  }
  const [rosterSize] = await tx.select({ count: count() })
    .from(eventRosterMembers)
    .innerJoin(eventRosters, eq(eventRosterMembers.eventRosterId, eventRosters.id))
    .where(and(eq(eventRosters.entryId, input.entryId), eq(eventRosterMembers.isCurrent, true)));
  if (Number(rosterSize?.count ?? 0) >= season.maxTeamSize) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "队伍人数已达到上限");
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
        eq(eventRosterMembers.isCurrent, true),
        eq(seasonRegistrations.primaryPosition, targetRegistration.primaryPosition),
      ),
    );
  if (!canPickPosition(Number(positionCount?.count ?? 0), rules.source === "policy_v2" ? rules.roster.maxPerPositionPerTeam : 2)) {
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
    status: rules.source === "policy_v2" ? "invited" : "confirmed",
    confirmedAt: rules.source === "policy_v2" ? null : now,
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
    isPrimaryStarter: isStarterRound(ds.currentRound, format.starterPicks),
    primaryPosition: targetRegistration.primaryPosition,
  });
  await tx.insert(eventRosterMembers).values({
    eventRosterId: roster.id,
    participantId: participant.id,
    userId: targetRegistration.userId,
    isPrimaryStarter: isStarterRound(ds.currentRound, format.starterPicks),
  });

  await writeAuditInTx(tx, {
    seasonId: input.seasonId,
    action: "draft.pick",
    actorId: input.captainUserId ?? "system:auto-pick",
    targetId: pick.id,meta: {
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
  const next = getNextEntryId(seasonTeams, input.entryId, ds.currentRound, format.rounds);

  if (!next) {
    await finalizeDraft(tx, {
      seasonId: input.seasonId,
      draftStateId: ds.id,
      now,
      totalRounds: format.rounds,
      actorId: input.captainUserId ?? "system:draft",
    });

    return { pickId: pick.id, slug: season.slug, idempotent: false, completed: true };
  }

  const deadline = new Date(now.getTime() + format.timeoutSeconds * 1000);
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

export async function finalizeDraft(
  tx: DraftTransaction,
  input: { seasonId: string; draftStateId: string; now: Date; totalRounds: number; actorId: string },
): Promise<void> {
  await tx
    .update(draftState)
    .set({
      currentRound: input.totalRounds + 1,
      currentEntryId: null,
      roundDeadline: null,
      isActive: false,
      updatedAt: input.now,
    })
    .where(eq(draftState.id, input.draftStateId));
  const season = await tx.query.seasons.findFirst({ where: eq(seasons.id, input.seasonId) });
  if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);
  if (decodeSeasonRules(season).source !== "policy_v2") {
    // Published legacy drafts historically completed their rosters and entered play here.
    await tx.update(seasons).set({ status: "playing", updatedAt: input.now }).where(eq(seasons.id, input.seasonId));
    await tx.update(eventRosters).set({ sourceRosterRevisionId: sql`(SELECT entry.current_roster_revision_id FROM competition_entries entry WHERE entry.id = ${eventRosters.entryId})`, status: "frozen", confirmedAt: input.now, confirmedBy: input.actorId, frozenAt: input.now, frozenBy: input.actorId, updatedAt: input.now }).where(sql`${eventRosters.entryId} IN (SELECT ${competitionEntries.id} FROM ${competitionEntries} WHERE ${competitionEntries.competitionId} = ${input.seasonId})`);
    await tx.update(competitionEntryRosterRevisions).set({ status: "approved", submittedAt: input.now, approvedAt: input.now }).where(sql`${competitionEntryRosterRevisions.entryId} IN (SELECT ${competitionEntries.id} FROM ${competitionEntries} WHERE ${competitionEntries.competitionId} = ${input.seasonId}) AND ${competitionEntryRosterRevisions.id} = (SELECT entry.current_roster_revision_id FROM competition_entries entry WHERE entry.id = ${competitionEntryRosterRevisions.entryId})`);
    await tx.update(competitionEntries).set({ approvedRosterRevisionId: competitionEntries.currentRosterRevisionId, updatedAt: input.now }).where(eq(competitionEntries.competitionId, input.seasonId));
  }
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
    const rules = decodeSeasonRules(season);
    const selected = selectAutoPickCandidate(candidates, positionCounts, rules.source === "policy_v2" ? rules.roster.maxPerPositionPerTeam : 2);
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
    .where(and(eq(eventRosters.entryId, entryId), eq(eventRosterMembers.isCurrent, true)))
    .groupBy(seasonRegistrations.primaryPosition);

  return Object.fromEntries(rows.map((row) => [row.primaryPosition, Number(row.count)]));
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
