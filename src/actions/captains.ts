"use server";

import { writeAuditInTx } from "@/lib/audit/write";

import { randomUUID } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import { db, type TxDb } from "@/db/client";
import {
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
} from "@/db/schema";
import { ok, fail, type ActionResult } from "@/types/action";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";
import { lockGameplayIdentityWriteInTx } from "@/lib/identity/write-lock";
import { auditActorId, requireAuth, requireSeasonAdmin } from "@/lib/auth/session";
import {
  castVoteSchema,
  confirmCaptainsSchema,
  retractVoteSchema,
  type CastVoteInput,
  type ConfirmCaptainsInput,
  type RetractVoteInput,
} from "@/lib/validators/vote";
import { getCaptainConfirmationBlocker, validateCaptainVote } from "@/lib/captains/rules";
import { getAdminCaptainRanking, getSeasonTeamCount } from "@/lib/captains/data";
import { failValidation, actionError, isPgUniqueViolation } from "@/lib/action-utils";
import { revalidateSeasonPaths } from "@/lib/revalidation";

const CAPTAIN_VOTE_UNIQUE_CONSTRAINT =
  "captain_votes_voter_registration_id_candidate_registration_id_unique";

async function loadLockedVoteContext(tx: TxDb, input: CastVoteInput, userId: string) {
  // Lock the season before the voter. Votes in different rows can proceed
  // together, while confirmation and registration review hold it exclusively.
  const [season] = await tx
    .select({
      id: seasons.id,
      status: seasons.status,
      hasCaptainVoting: seasons.hasCaptainVoting,
    })
    .from(seasons)
    .innerJoin(seasonRegistrations, eq(seasonRegistrations.seasonId, seasons.id))
    .where(eq(seasonRegistrations.id, input.voterRegistrationId))
    .for("share", { of: seasons });
  if (!season) throw new AppError(ErrorCode.NOT_FOUND, "报名记录不存在");

  const [voter] = await tx
    .select()
    .from(seasonRegistrations)
    .where(eq(seasonRegistrations.id, input.voterRegistrationId))
    .for("no key update");
  const candidate = await tx.query.seasonRegistrations.findFirst({
    where: eq(seasonRegistrations.id, input.candidateRegistrationId),
  });
  if (!voter || !candidate) throw new AppError(ErrorCode.NOT_FOUND, "报名记录不存在");
  if (voter.userId !== userId) throw new AppError(ErrorCode.FORBIDDEN, ERROR_MESSAGES.FORBIDDEN);
  if (voter.seasonId !== season.id || candidate.seasonId !== season.id) {
    throw new AppError(ErrorCode.CAPTAIN_NOT_ELIGIBLE, ERROR_MESSAGES.CAPTAIN_NOT_ELIGIBLE);
  }
  return { season, voter, candidate };
}

export async function castVote(input: CastVoteInput): Promise<ActionResult<{ voteId: string }>> {
  const parsed = castVoteSchema.safeParse(input);
  if (!parsed.success) {
    return failValidation("投票参数无效");
  }

  try {
    const session = await requireAuth();
    const voteId = await db.transaction(async (tx) => {
      const { season, voter, candidate } = await loadLockedVoteContext(
        tx,
        parsed.data,
        session.userId,
      );

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

    await writeAuditInTx(db, {
      seasonId: null,
      action: "captain.cast_vote",
      actorId: session.userId,
      targetId: parsed.data.candidateRegistrationId,
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
      const { season, voter, candidate } = await loadLockedVoteContext(
        tx,
        parsed.data,
        session.userId,
      );
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

    await writeAuditInTx(db, {
      seasonId: null,
      action: "captain.retract_vote",
      actorId: session.userId,
      targetId: parsed.data.candidateRegistrationId,
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
      // Identity merge can update the eligible user and remap their votes.
      await lockGameplayIdentityWriteInTx(tx);
      const [season] = await tx
        .select({
          id: seasons.id,
          slug: seasons.slug,
          status: seasons.status,
          hasCaptainVoting: seasons.hasCaptainVoting,
          hasDraft: seasons.hasDraft,
        })
        .from(seasons)
        .where(eq(seasons.id, parsed.data.seasonId))
        .for("update");
      if (!season) {
        throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);
      }
      const teamCount = await getSeasonTeamCount(season.id, tx);
      const { seeds, totalVotes, candidateCount } = await getAdminCaptainRanking(season.id, tx);
      const blocker = getCaptainConfirmationBlocker({
        season,
        teamCount,
        totalVotes,
        candidateCount,
      });
      if (blocker) throw new AppError(blocker.code, blocker.message);

      if (
        seeds.some(({ id, userId }, index) => {
          const expected = parsed.data.expectedCaptains[index];
          return id !== expected.registrationId || userId !== expected.userId;
        })
      ) {
        throw new AppError(
          ErrorCode.VALIDATION_FAILED,
          "队长名单或选秀顺位已变化，请刷新后重新核对。",
        );
      }

      const createdEntryIds: string[] = [];
      for (const [index, captain] of seeds.entries()) {
        const revisionId = randomUUID();
        const [entry] = await tx
          .insert(competitionEntries)
          .values({
            competitionId: season.id,
            source: "event_native",
            name: `${captain.displayName} 队`,
            representativeUserId: captain.userId,
            sourceRegistrationId: captain.id,
            formationOrder: index + 1,
            registrationStatus: "approved",
            currentRosterRevisionId: revisionId,
          })
          .returning({ id: competitionEntries.id });
        createdEntryIds.push(entry.id);

        const [participant] = await tx
          .insert(competitionEntryParticipants)
          .values({
            entryId: entry.id,
            userId: captain.userId,
            status: "confirmed",
            confirmedAt: new Date(),
            invitedByUserId: captain.userId,
          })
          .returning({ id: competitionEntryParticipants.id });
        const [revision] = await tx
          .insert(competitionEntryRosterRevisions)
          .values({
            id: revisionId,
            entryId: entry.id,
            revisionNumber: 1,
            status: "draft",
            createdBy: auditActorId(admin),
          })
          .returning({ id: competitionEntryRosterRevisions.id });
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
        const [eventRoster] = await tx
          .insert(eventRosters)
          .values({
            entryId: entry.id,
            status: "preparing",
          })
          .returning({ id: eventRosters.id });
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

      await writeAuditInTx(tx, {
        seasonId: season.id,
        action: "captain.confirm",
        actorId: auditActorId(admin),
        targetId: season.id,
        meta: {
          captainRegistrationIds: seeds.map((seed) => seed.id),
          entryIds: createdEntryIds,
        },
      });

      return { seasonSlug: season.slug, entryIds: createdEntryIds };
    });

    revalidateSeasonPaths(result.seasonSlug, [
      "captains",
      "teams",
      "draft",
      "adminCaptains",
      "adminDraft",
    ]);
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
  revalidateSeasonPaths(season.slug, ["captains", "adminCaptains"], { statistics: false });
}
