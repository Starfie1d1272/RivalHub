import { and, asc, count, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { captainVotes, seasonRegistrations, users, teams } from "@/db/schema";
import { compareCaptainSeedCandidates, selectCaptainSeeds } from "@/lib/captains/rules";

export interface CaptainVoterOption {
  id: string;
  displayName: string;
  email: string;
  primaryPosition: string;
  peakRank: string;
  peakRating: number;
}

export interface CaptainCandidateRow extends CaptainVoterOption {
  registrationId: string;
  voteCount: number;
  currentRating: number;
  createdAt: string;
}

export interface CaptainVoteRecord {
  voterRegistrationId: string;
  candidateRegistrationId: string;
}

export interface CaptainVotingData {
  voters: CaptainVoterOption[];
  candidates: CaptainCandidateRow[];
  votes: CaptainVoteRecord[];
}

export async function getCaptainVotingData(seasonId: string): Promise<CaptainVotingData> {
  const registrations = await db
    .select({
      id: seasonRegistrations.id,
      primaryPosition: seasonRegistrations.primaryPosition,
      peakRank: seasonRegistrations.peakRank,
      peakRating: seasonRegistrations.peakRating,
      currentRating: seasonRegistrations.currentRating,
      willingToBeCaptain: seasonRegistrations.willingToBeCaptain,
      createdAt: seasonRegistrations.createdAt,
      email: users.email,
      steamName: users.steamName,
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
            voterRegistrationId: captainVotes.voterRegistrationId,
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

  const voters: CaptainVoterOption[] = registrations.map((r) => ({
    id: r.id,
    displayName: r.steamName ?? r.email ?? "未命名选手",
    email: r.email ?? "",
    primaryPosition: r.primaryPosition,
    peakRank: r.peakRank,
    peakRating: r.peakRating,
  }));

  const candidateRows: CaptainCandidateRow[] = registrations
    .filter((r) => r.willingToBeCaptain)
    .map((r) => ({
      id: r.id,
      registrationId: r.id,
      displayName: r.steamName ?? r.email ?? "未命名选手",
      email: r.email ?? "",
      primaryPosition: r.primaryPosition,
      peakRank: r.peakRank,
      peakRating: r.peakRating,
      currentRating: r.currentRating,
      createdAt: r.createdAt.toISOString(),
      voteCount: voteCounts.get(r.id) ?? 0,
    }));

  const seedRows = selectCaptainSeeds(candidateRows);
  const sortedCandidates = seedRows.concat(
    candidateRows
      .filter((candidate) => !seedRows.some((seed) => seed.registrationId === candidate.registrationId))
      .sort(compareCaptainSeedCandidates),
  );

  return {
    voters,
    candidates: sortedCandidates,
    votes: voteRows,
  };
}

export async function getSeasonTeamCount(seasonId: string): Promise<number> {
  const [row] = await db.select({ count: count() }).from(teams).where(eq(teams.seasonId, seasonId));
  return Number(row?.count ?? 0);
}
