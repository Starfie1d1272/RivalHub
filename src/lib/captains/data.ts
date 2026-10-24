import { and, asc, count, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { captainVotes, seasonRegistrations, steamProfiles, users, competitionEntries } from "@/db/schema";
import { CAPTAIN_TEAM_COUNT, compareCaptainSeedCandidates, selectCaptainSeeds } from "@/lib/captains/rules";
import { getPublicDisplayName } from "@/lib/identity/display-name";

/** Fields allowed to cross the public captains page boundary. */
export interface PublicCaptainVoter {
  userId: string;
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
  userId: string;
  id: string;
  displayName: string | null;
  perfectName: string | null;
  personaName: string | null;
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
    userId: row.userId,
    displayName: getPublicDisplayName(row),
    primaryPosition: row.primaryPosition,
    peakRank: row.peakRank,
    peakRating: row.peakRating,
    currentRating: row.currentRating,
    voteCount: row.voteCount,
  };
}

async function readCaptainVotingData(
  seasonId: string, includeVoters: boolean,
): Promise<PublicCaptainVotingData> {
  const registrations = await db
    .select({
      id: seasonRegistrations.id,
      userId: users.id,
      primaryPosition: seasonRegistrations.primaryPosition,
      peakRank: seasonRegistrations.peakRank,
      peakRating: seasonRegistrations.peakRating,
      currentRating: seasonRegistrations.currentRating,
      willingToBeCaptain: seasonRegistrations.willingToBeCaptain,
      createdAt: seasonRegistrations.createdAt,
      personaName: steamProfiles.personaName,
      displayName: users.displayName,
      perfectName: users.perfectName,
    })
    .from(seasonRegistrations)
    .innerJoin(users, and(eq(seasonRegistrations.userId, users.id), eq(users.status, "active")))
    .leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64))
    .where(
      and(
        eq(seasonRegistrations.seasonId, seasonId),
        eq(seasonRegistrations.status, "approved"),
        includeVoters ? undefined : eq(seasonRegistrations.willingToBeCaptain, true),
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
            voteCount: count(),
          })
          .from(captainVotes)
          .where(inArray(captainVotes.candidateRegistrationId, registrationIds))
          .groupBy(captainVotes.candidateRegistrationId);

  const voteCounts = new Map(voteRows.map((vote) => [vote.candidateRegistrationId, vote.voteCount]));

  const voters: PublicCaptainVoter[] = includeVoters ? registrations.map((r) => ({
    id: r.id,
    userId: r.userId,
    displayName: getPublicDisplayName(r),
    primaryPosition: r.primaryPosition,
    peakRank: r.peakRank,
    peakRating: r.peakRating,
  })) : [];

  const candidateRows: CaptainCandidateRankingRow[] = registrations
    .filter((r) => r.willingToBeCaptain)
    .map((r) => ({
      ...serializePublicCaptainCandidate({
        id: r.id,
    userId: r.userId,
        displayName: r.displayName,
        perfectName: r.perfectName,
        personaName: r.personaName,
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
      userId: candidate.userId,
      displayName: candidate.displayName,
      primaryPosition: candidate.primaryPosition,
      peakRank: candidate.peakRank,
      peakRating: candidate.peakRating,
      currentRating: candidate.currentRating,
      voteCount: candidate.voteCount,
    })),
  };
}

export async function getPublicCaptainVotingData(seasonId: string): Promise<PublicCaptainVotingData> {
  return readCaptainVotingData(seasonId, true);
}

export type AdminCaptainSeed = Omit<PublicCaptainCandidate, "peakRank">;

/** Confirmation still rechecks canonical ranking; the panel displays only eight seeds. */
export async function getAdminCaptainRanking(seasonId: string): Promise<{ seeds: AdminCaptainSeed[]; candidateCount: number }> {
  const { candidates } = await readCaptainVotingData(seasonId, false);
  return {
    candidateCount: candidates.length,
    seeds: candidates.slice(0, CAPTAIN_TEAM_COUNT).map(({ id, userId, displayName, primaryPosition, peakRating, currentRating, voteCount }) =>
      ({ id, userId, displayName, primaryPosition, peakRating, currentRating, voteCount })),
  };
}

export async function getSeasonTeamCount(seasonId: string): Promise<number> {
  const [row] = await db.select({ count: count() }).from(competitionEntries).where(eq(competitionEntries.competitionId, seasonId));
  return Number(row?.count ?? 0);
}

/** Public candidate facts establish the approved, active event membership first. */
export async function getCaptainVotingViewer(data: PublicCaptainVotingData, userId: string | null) {
  const currentVoter = data.voters.find(voter => voter.userId === userId) ?? null;
  const votes: CaptainVoteRecord[] = currentVoter ? await db.select({
    voterRegistrationId: captainVotes.voterRegistrationId,
    candidateRegistrationId: captainVotes.candidateRegistrationId,
  }).from(captainVotes).where(eq(captainVotes.voterRegistrationId, currentVoter.id)) : [];
  return { currentVoter, votes };
}
