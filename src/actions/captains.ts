"use server";

import { revalidatePath } from "next/cache";
import { and, count, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  auditLogs,
  captainVotes,
  seasonRegistrations,
  seasons,
  teamMembers,
  teams,
  users,
} from "@/db/schema";
import { fail, ok, type ActionResult } from "@/types/action";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";
import { requireSeasonAdmin } from "@/lib/auth/session";
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
  selectCaptainSeeds,
  validateCaptainVote,
} from "@/lib/captains/rules";

export async function castVote(
  input: CastVoteInput,
): Promise<ActionResult<{ voteId: string }>> {
  const parsed = castVoteSchema.safeParse(input);
  if (!parsed.success) {
    return failValidation("投票参数无效");
  }

  try {
    const voteId = await db.transaction(async (tx) => {
      const voter = await tx.query.seasonRegistrations.findFirst({
        where: eq(seasonRegistrations.id, parsed.data.voterRegistrationId),
      });
      const candidate = await tx.query.seasonRegistrations.findFirst({
        where: eq(seasonRegistrations.id, parsed.data.candidateRegistrationId),
      });
      if (!voter || !candidate) {
        throw new AppError(ErrorCode.NOT_FOUND, "报名记录不存在");
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

    await revalidateCaptainPaths(parsed.data.voterRegistrationId);
    return ok({ voteId });
  } catch (e) {
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

    await revalidateCaptainPaths(parsed.data.voterRegistrationId);
    return ok({ removed: true });
  } catch (e) {
    return actionError("retractVote", e);
  }
}

export async function confirmCaptains(
  input: ConfirmCaptainsInput,
): Promise<ActionResult<{ teamIds: string[] }>> {
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

      const [existingTeamCount] = await tx
        .select({ count: count() })
        .from(teams)
        .where(eq(teams.seasonId, season.id));
      if (Number(existingTeamCount?.count ?? 0) > 0) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, "该赛季已生成队伍");
      }

      const candidates = await tx
        .select({
          registrationId: seasonRegistrations.id,
          peakRating: seasonRegistrations.peakRating,
          createdAt: seasonRegistrations.createdAt,
          steamName: users.steamName,
          email: users.email,
        })
        .from(seasonRegistrations)
        .leftJoin(users, eq(seasonRegistrations.userId, users.id))
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

      const createdTeamIds: string[] = [];
      for (const [index, captain] of seeds.entries()) {
        const captainName = captain.steamName ?? captain.email ?? `队长 ${index + 1}`;
        const [team] = await tx
          .insert(teams)
          .values({
            seasonId: season.id,
            name: `${captainName} 队`,
            captainRegistrationId: captain.registrationId,
            draftOrder: index + 1,
          })
          .returning({ id: teams.id });
        createdTeamIds.push(team.id);

        await tx.insert(teamMembers).values({
          teamId: team.id,
          registrationId: captain.registrationId,
          isStarter: true,
        });
      }

      await tx
        .update(seasons)
        .set({ status: "drafting", updatedAt: new Date() })
        .where(eq(seasons.id, season.id));

      await tx.insert(auditLogs).values({
        seasonId: season.id,
        action: "captains.confirm",
        actorId: admin.email,
        targetId: season.id,
        targetType: "season",
        meta: {
          captainRegistrationIds: seeds.map((seed) => seed.registrationId),
          teamIds: createdTeamIds,
        },
      });

      return { seasonSlug: season.slug, teamIds: createdTeamIds };
    });

    revalidatePath(`/${result.seasonSlug}/captains`);
    revalidatePath(`/${result.seasonSlug}/teams`);
    revalidatePath(`/${result.seasonSlug}/draft`);
    revalidatePath(`/admin/${result.seasonSlug}/captains`);
    revalidatePath(`/admin/${result.seasonSlug}/draft`);
    return ok({ teamIds: result.teamIds });
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

  revalidatePath(`/${season.slug}/captains`);
  revalidatePath(`/admin/${season.slug}/captains`);
}

function failValidation(message: string): ActionResult<never> {
  return fail({ code: ErrorCode.VALIDATION_FAILED, message });
}

function actionError(scope: string, e: unknown): ActionResult<never> {
  if (e instanceof AppError) {
    return fail({ code: e.code, message: e.message });
  }
  console.error(`[${scope}]`, e);
  return fail({ code: ErrorCode.INTERNAL_ERROR, message: ERROR_MESSAGES.INTERNAL_ERROR });
}
