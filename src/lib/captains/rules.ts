import { ErrorCode, type ErrorCode as ErrorCodeValue } from "@/lib/errors";

export const MAX_CAPTAIN_VOTES = 3;
export const CAPTAIN_TEAM_COUNT = 8;
/** 确认队长前至少需要的总投票数（防止投票尚未开始就确认） */
export const MIN_VOTES_FOR_CONFIRM = 3;

export interface CaptainVoteSeason {
  status: string;
  hasCaptainVoting: boolean;
}

export interface CaptainVoteRegistration {
  id: string;
  seasonId: string;
  status: string;
  willingToBeCaptain: boolean;
}

export interface ValidateCaptainVoteInput {
  season: CaptainVoteSeason;
  voter: CaptainVoteRegistration;
  candidate: CaptainVoteRegistration;
  existingVoteCount: number;
  alreadyVotedForCandidate: boolean;
}

export interface CaptainSeedCandidate {
  registrationId: string;
  voteCount: number;
  peakRating: number;
  createdAt: Date | string;
}

export function validateCaptainVote({
  season,
  voter,
  candidate,
  existingVoteCount,
  alreadyVotedForCandidate,
}: ValidateCaptainVoteInput): ErrorCodeValue | null {
  if (!season.hasCaptainVoting || season.status !== "voting") {
    return ErrorCode.VOTING_CLOSED;
  }
  if (voter.seasonId !== candidate.seasonId) {
    return ErrorCode.CAPTAIN_NOT_ELIGIBLE;
  }
  if (voter.status !== "approved") {
    return ErrorCode.FORBIDDEN;
  }
  if (candidate.status !== "approved" || !candidate.willingToBeCaptain) {
    return ErrorCode.CAPTAIN_NOT_ELIGIBLE;
  }
  if (voter.id === candidate.id) {
    return ErrorCode.VOTE_SELF;
  }
  if (existingVoteCount >= MAX_CAPTAIN_VOTES) {
    return ErrorCode.VOTE_LIMIT_REACHED;
  }
  if (alreadyVotedForCandidate) {
    return ErrorCode.VOTE_DUPLICATE;
  }
  return null;
}

export function selectCaptainSeeds<T extends CaptainSeedCandidate>(candidates: T[]): T[] {
  return [...candidates].sort(compareCaptainSeedCandidates).slice(0, CAPTAIN_TEAM_COUNT);
}

export function compareCaptainSeedCandidates(
  a: CaptainSeedCandidate,
  b: CaptainSeedCandidate,
): number {
  if (b.voteCount !== a.voteCount) return b.voteCount - a.voteCount;
  if (b.peakRating !== a.peakRating) return b.peakRating - a.peakRating;
  return createdAtTime(a.createdAt) - createdAtTime(b.createdAt);
}

function createdAtTime(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}
