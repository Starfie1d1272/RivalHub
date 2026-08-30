import { and, asc, count, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { captainVotes, seasonRegistrations, users, competitionEntries } from "@/db/schema";
import { compareCaptainSeedCandidates, selectCaptainSeeds } from "@/lib/captains/rules";
import { getPublicDisplayName } from "@/lib/utils/display-name";

/** Fields allowed to cross the public captains page boundary. */
export interface PublicCaptainVoter {
  id: string;
  displayName: string;
  primaryPosition: string;
  peakRank: string;
  peakRating: number;
}

/** Fields allowed to cross the public captains page boundary. */
export interface PublicCaptainCandidate extends PublicCaptainVoter {
  voteCount: number;
  currentRating: number;
}

export interface CaptainVoteRecord {
  voterRegistrationId: string;
  candidateRegistrationId: string;
}

export interface PublicCaptainVotingData {
  voters: PublicCaptainVoter[];
  candidates: PublicCaptainCandidate[];
}

interface CaptainCandidateRankingRow extends PublicCaptainCandidate {
  registrationId: string;
  createdAt: Date;
  willingToBeCaptain: boolean;
}

interface CaptainCandidateSource {
  id: string;
  displayName: string | null;
  perfectName: string | null;
  steamName: string | null;
  primaryPosition: string;
  peakRank: string;
  peakRating: number;
  currentRating: number;
  voteCount: number;
}

/**
 * Explicitly serialize the public candidate contract. Keeping this separate
 * from the query row prevents an added private column from leaking into RSC.
 */
export function serializePublicCaptainCandidate(
  row: CaptainCandidateSource,
): PublicCaptainCandidate {
  return {
    id: row.id,
    displayName: getPublicDisplayName(row),
    primaryPosition: row.primaryPosition,
    peakRank: row.peakRank,
    peakRating: row.peakRating,
    currentRating: row.currentRating,
    voteCount: row.voteCount,
  };
}

export async function getPublicCaptainVotingData(
  seasonId: string,
): Promise<PublicCaptainVotingData> {
  const registrations = await db
    .select({
      id: seasonRegistrations.id,
      primaryPosition: seasonRegistrations.primaryPosition,
      peakRank: seasonRegistrations.peakRank,
      peakRating: seasonRegistrations.peakRating,
      currentRating: seasonRegistrations.currentRating,
      willingToBeCaptain: seasonRegistrations.willingToBeCaptain,
      createdAt: seasonRegistrations.createdAt,
      steamName: users.steamName,
      displayName: users.displayName,
      perfectName: users.perfectName,
    })
    .from(seasonRegistrations)
    .leftJoin(users, eq(seasonRegistrations.userId, users.id))
    .where(
      and(
        eq(seasonRegistrations.seasonId, seasonId),
        eq(seasonRegistrations.status, "approved"),
      ),
    )
    .orderBy(asc(seasonRegistrations.createdAt));

  const registrationIds = registrations.map((r) => r.id);
  const voteRows =
    registrationIds.length === 0
      ? []
      : await db
          .select({
            candidateRegistrationId: captainVotes.candidateRegistrationId,
          })
          .from(captainVotes)
          .where(inArray(captainVotes.candidateRegistrationId, registrationIds));

  const voteCounts = new Map<string, number>();
  for (const vote of voteRows) {
    voteCounts.set(
      vote.candidateRegistrationId,
      (voteCounts.get(vote.candidateRegistrationId) ?? 0) + 1,
    );
  }

  const voters: PublicCaptainVoter[] = registrations.map((r) => ({
    id: r.id,
    displayName: getPublicDisplayName(r),
    primaryPosition: r.primaryPosition,
    peakRank: r.peakRank,
    peakRating: r.peakRating,
  }));

  const candidateRows: CaptainCandidateRankingRow[] = registrations
    .filter((r) => r.willingToBeCaptain)
    .map((r) => ({
      ...serializePublicCaptainCandidate({
        id: r.id,
        displayName: r.displayName,
        perfectName: r.perfectName,
        steamName: r.steamName,
        primaryPosition: r.primaryPosition,
        peakRank: r.peakRank,
        peakRating: r.peakRating,
        currentRating: r.currentRating,
        voteCount: voteCounts.get(r.id) ?? 0,
      }),
      registrationId: r.id,
      createdAt: r.createdAt,
      willingToBeCaptain: r.willingToBeCaptain,
    }));

  const seedRows = selectCaptainSeeds(candidateRows);
  const sortedRankingRows = seedRows.concat(
    candidateRows
      .filter((candidate) => !seedRows.some((seed) => seed.registrationId === candidate.registrationId))
      .sort(compareCaptainSeedCandidates),
  );

  return {
    voters,
    candidates: sortedRankingRows.map((candidate) => ({
      id: candidate.id,
      displayName: candidate.displayName,
      primaryPosition: candidate.primaryPosition,
      peakRank: candidate.peakRank,
      peakRating: candidate.peakRating,
      currentRating: candidate.currentRating,
      voteCount: candidate.voteCount,
    })),
  };
}

export async function getSeasonTeamCount(seasonId: string): Promise<number> {
  const [row] = await db.select({ count: count() }).from(competitionEntries).where(eq(competitionEntries.competitionId, seasonId));
  return Number(row?.count ?? 0);
}
