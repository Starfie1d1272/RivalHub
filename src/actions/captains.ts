"use server";

import { randomUUID } from "node:crypto";
import { and, count, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  auditLogs,
  captainVotes,
  competitionEntries,
  competitionEntryParticipants,
  competitionEntryRepresentativeChanges,
  competitionEntryRosterMembers,
  competitionEntryRosterRevisions,
  eventRosterMembers,
  eventRosters,
  seasonRegistrations,
  seasons,
  users,
} from "@/db/schema";
import { ok, fail, type ActionResult } from "@/types/action";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { auditActorId, requireAuth, requireSeasonAdmin } from "@/lib/auth/session";
import {
  castVoteSchema,
  confirmCaptainsSchema,
  retractVoteSchema,
  type CastVoteInput,
  type ConfirmCaptainsInput,
  type RetractVoteInput,
} from "@/lib/validators/vote";
import {
  CAPTAIN_TEAM_COUNT,
  MIN_VOTES_FOR_CONFIRM,
  selectCaptainSeeds,
  validateCaptainVote,
} from "@/lib/captains/rules";
import { failValidation, actionError, isPgUniqueViolation } from "@/lib/action-utils";
import { revalidateSeasonPaths } from "@/lib/revalidation";

const CAPTAIN_VOTE_UNIQUE_CONSTRAINT = "captain_votes_voter_registration_id_candidate_registration_id_unique";

export async function castVote(
  input: CastVoteInput,
): Promise<ActionResult<{ voteId: string }>> {
  const parsed = castVoteSchema.safeParse(input);
  if (!parsed.success) {
    return failValidation("投票参数无效");
  }

  try {
    const session = await requireAuth();
    const voteId = await db.transaction(async (tx) => {
      // Serialize count + insert per voter; without this row lock, two tabs
      // can both observe two votes and exceed the three-vote cap.
      const [voter] = await tx.select().from(seasonRegistrations)
        .where(eq(seasonRegistrations.id, parsed.data.voterRegistrationId)).for("update");
      const candidate = await tx.query.seasonRegistrations.findFirst({
        where: eq(seasonRegistrations.id, parsed.data.candidateRegistrationId),
      });
      if (!voter || !candidate) {
        throw new AppError(ErrorCode.NOT_FOUND, "报名记录不存在");
      }
      if (voter.userId !== session.userId) {
        throw new AppError(ErrorCode.FORBIDDEN, ERROR_MESSAGES.FORBIDDEN);
      }

      const season = await tx.query.seasons.findFirst({
        where: eq(seasons.id, voter.seasonId),
      });
      if (!season) {
        throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);
      }

      const [voteCountRow] = await tx
        .select({ count: count() })
        .from(captainVotes)
        .where(eq(captainVotes.voterRegistrationId, voter.id));
      const existingVote = await tx.query.captainVotes.findFirst({
        where: and(
          eq(captainVotes.voterRegistrationId, voter.id),
          eq(captainVotes.candidateRegistrationId, candidate.id),
        ),
      });

      const errorCode = validateCaptainVote({
        season,
        voter,
        candidate,
        existingVoteCount: Number(voteCountRow?.count ?? 0),
        alreadyVotedForCandidate: Boolean(existingVote),
      });
      if (errorCode) {
        throw new AppError(errorCode, ERROR_MESSAGES[errorCode]);
      }

      const [vote] = await tx
        .insert(captainVotes)
        .values({
          voterRegistrationId: voter.id,
          candidateRegistrationId: candidate.id,
        })
        .returning({ id: captainVotes.id });
      return vote.id;
    });

    await db.insert(auditLogs).values({
      seasonId: null,
      action: "captain.cast_vote",
      actorId: session.userId,
      targetId: parsed.data.candidateRegistrationId,
      targetType: "captain_vote",
      meta: { voteId, voterRegistrationId: parsed.data.voterRegistrationId },
    });

    await revalidateCaptainPaths(parsed.data.voterRegistrationId);
    return ok({ voteId });
  } catch (e) {
    if (isPgUniqueViolation(e, CAPTAIN_VOTE_UNIQUE_CONSTRAINT)) {
      return fail({ code: ErrorCode.VOTE_DUPLICATE, message: ERROR_MESSAGES.VOTE_DUPLICATE });
    }
    return actionError("castVote", e);
  }
}

export async function retractVote(
  input: RetractVoteInput,
): Promise<ActionResult<{ removed: boolean }>> {
  const parsed = retractVoteSchema.safeParse(input);
  if (!parsed.success) {
    return failValidation("撤回投票参数无效");
  }

  try {
    const session = await requireAuth();
    await db.transaction(async (tx) => {
      const voter = await tx.query.seasonRegistrations.findFirst({
        where: eq(seasonRegistrations.id, parsed.data.voterRegistrationId),
      });
      const candidate = await tx.query.seasonRegistrations.findFirst({
        where: eq(seasonRegistrations.id, parsed.data.candidateRegistrationId),
      });
      if (!voter || !candidate) {
        throw new AppError(ErrorCode.NOT_FOUND, "报名记录不存在");
      }
      if (voter.userId !== session.userId) {
        throw new AppError(ErrorCode.FORBIDDEN, ERROR_MESSAGES.FORBIDDEN);
      }
      if (voter.seasonId !== candidate.seasonId) {
        throw new AppError(ErrorCode.CAPTAIN_NOT_ELIGIBLE, ERROR_MESSAGES.CAPTAIN_NOT_ELIGIBLE);
      }

      const season = await tx.query.seasons.findFirst({
        where: eq(seasons.id, voter.seasonId),
      });
      if (!season) {
        throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);
      }
      if (!season.hasCaptainVoting || season.status !== "voting") {
        throw new AppError(ErrorCode.VOTING_CLOSED, ERROR_MESSAGES.VOTING_CLOSED);
      }

      await tx
        .delete(captainVotes)
        .where(
          and(
            eq(captainVotes.voterRegistrationId, voter.id),
            eq(captainVotes.candidateRegistrationId, candidate.id),
          ),
        );
    });

    await db.insert(auditLogs).values({
      seasonId: null,
      action: "captain.retract_vote",
      actorId: session.userId,
      targetId: parsed.data.candidateRegistrationId,
      targetType: "captain_vote",
      meta: { voterRegistrationId: parsed.data.voterRegistrationId },
    });

    await revalidateCaptainPaths(parsed.data.voterRegistrationId);
    return ok({ removed: true });
  } catch (e) {
    return actionError("retractVote", e);
  }
}

export async function confirmCaptains(
  input: ConfirmCaptainsInput,
): Promise<ActionResult<{ entryIds: string[] }>> {
  const parsed = confirmCaptainsSchema.safeParse(input);
  if (!parsed.success) {
    return failValidation("确认队长参数无效");
  }

  try {
    const admin = await requireSeasonAdmin(parsed.data.seasonId);
    const result = await db.transaction(async (tx) => {
      const season = await tx.query.seasons.findFirst({
        where: eq(seasons.id, parsed.data.seasonId),
      });
      if (!season) {
        throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);
      }
      if (!season.hasCaptainVoting || !season.hasDraft) {
        throw new AppError(
          ErrorCode.SEASON_CAPABILITY_DISABLED,
          ERROR_MESSAGES.SEASON_CAPABILITY_DISABLED,
        );
      }
      if (season.status !== "voting") {
        throw new AppError(ErrorCode.SEASON_INVALID_STATUS, ERROR_MESSAGES.SEASON_INVALID_STATUS);
      }

      const [existingEntryCount] = await tx
        .select({ count: count() })
        .from(competitionEntries)
        .where(eq(competitionEntries.competitionId, season.id));
      if (Number(existingEntryCount?.count ?? 0) > 0) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, "该赛事已生成参赛者");
      }

      // 防止投票尚未开始或参与不足就确认队长
      const [voteCountRow] = await tx
        .select({ count: count() })
        .from(captainVotes)
        .innerJoin(
          seasonRegistrations,
          eq(captainVotes.candidateRegistrationId, seasonRegistrations.id),
        )
        .where(eq(seasonRegistrations.seasonId, season.id));
      const totalVotes = Number(voteCountRow?.count ?? 0);
      if (totalVotes < MIN_VOTES_FOR_CONFIRM) {
        throw new AppError(
          ErrorCode.VOTING_MINIMUM_NOT_MET,
          `当前仅有 ${totalVotes} 票，至少需要 ${MIN_VOTES_FOR_CONFIRM} 票才能确认队长`,
        );
      }

      const candidates = await tx
        .select({
          registrationId: seasonRegistrations.id,
          userId: users.id,
          peakRating: seasonRegistrations.peakRating,
          createdAt: seasonRegistrations.createdAt,
          steamName: users.steamName,
          displayName: users.displayName,
          perfectName: users.perfectName,
        })
        .from(seasonRegistrations)
        .innerJoin(users, eq(seasonRegistrations.userId, users.id))
        .where(
          and(
            eq(seasonRegistrations.seasonId, season.id),
            eq(seasonRegistrations.status, "approved"),
            eq(seasonRegistrations.willingToBeCaptain, true),
          ),
        );
      if (candidates.length < CAPTAIN_TEAM_COUNT) {
        throw new AppError(
          ErrorCode.CAPTAIN_NOT_ELIGIBLE,
          `至少需要 ${CAPTAIN_TEAM_COUNT} 名已通过且愿意担任队长的候选人`,
        );
      }

      const candidateIds = candidates.map((candidate) => candidate.registrationId);
      const voteRows = await tx
        .select({ candidateRegistrationId: captainVotes.candidateRegistrationId })
        .from(captainVotes)
        .where(inArray(captainVotes.candidateRegistrationId, candidateIds));
      const voteCounts = new Map<string, number>();
      for (const vote of voteRows) {
        voteCounts.set(
          vote.candidateRegistrationId,
          (voteCounts.get(vote.candidateRegistrationId) ?? 0) + 1,
        );
      }

      const seeds = selectCaptainSeeds(
        candidates.map((candidate) => ({
          ...candidate,
          voteCount: voteCounts.get(candidate.registrationId) ?? 0,
        })),
      );

      const createdEntryIds: string[] = [];
      for (const [index, captain] of seeds.entries()) {
        const captainName = getPublicDisplayName(captain);
        const revisionId = randomUUID();
        const [entry] = await tx
          .insert(competitionEntries)
          .values({
            competitionId: season.id,
            source: "event_native",
            name: `${captainName} 队`,
            representativeUserId: captain.userId,
            sourceRegistrationId: captain.registrationId,
            formationOrder: index + 1,
            registrationStatus: "approved",
            currentRosterRevisionId: revisionId,
          })
          .returning({ id: competitionEntries.id });
        createdEntryIds.push(entry.id);

        const [participant] = await tx.insert(competitionEntryParticipants).values({
          entryId: entry.id,
          userId: captain.userId,
          status: "confirmed",
          confirmedAt: new Date(),
          invitedByUserId: captain.userId,
        }).returning({ id: competitionEntryParticipants.id });
        const [revision] = await tx.insert(competitionEntryRosterRevisions).values({
          id: revisionId,
          entryId: entry.id,
          revisionNumber: 1,
          status: "draft",
          createdBy: auditActorId(admin),
        }).returning({ id: competitionEntryRosterRevisions.id });
        await tx.insert(competitionEntryRepresentativeChanges).values({
          entryId: entry.id,
          fromUserId: null,
          toUserId: captain.userId,
          changedByActorId: auditActorId(admin),
        });
        await tx.insert(competitionEntryRosterMembers).values({
          revisionId: revision.id,
          participantId: participant.id,
          userId: captain.userId,
          isPrimaryStarter: true,
        });
        const [eventRoster] = await tx.insert(eventRosters).values({
          entryId: entry.id,
          status: "preparing",
        }).returning({ id: eventRosters.id });
        await tx.insert(eventRosterMembers).values({
          eventRosterId: eventRoster.id,
          participantId: participant.id,
          userId: captain.userId,
          isPrimaryStarter: true,
        });
      }

      await tx
        .update(seasons)
        .set({ status: "drafting", updatedAt: new Date() })
        .where(eq(seasons.id, season.id));

      await tx.insert(auditLogs).values({
        seasonId: season.id,
        action: "captain.confirm",
        actorId: auditActorId(admin),
        targetId: season.id,
        targetType: "season",
        meta: {
          captainRegistrationIds: seeds.map((seed) => seed.registrationId),
          entryIds: createdEntryIds,
        },
      });

      return { seasonSlug: season.slug, entryIds: createdEntryIds };
    });

    revalidateSeasonPaths(result.seasonSlug, ["captains", "teams", "draft", "adminCaptains", "adminDraft"]);
    return ok({ entryIds: result.entryIds });
  } catch (e) {
    return actionError("confirmCaptains", e);
  }
}

async function revalidateCaptainPaths(registrationId: string) {
  const registration = await db.query.seasonRegistrations.findFirst({
    where: eq(seasonRegistrations.id, registrationId),
    columns: { seasonId: true },
  });
  if (!registration) return;
  const season = await db.query.seasons.findFirst({
    where: eq(seasons.id, registration.seasonId),
    columns: { slug: true },
  });
  if (!season) return;
  revalidateSeasonPaths(season.slug, ["captains", "adminCaptains"]);
}
