import { describe, expect, it } from "vitest";
import { ErrorCode } from "@/lib/errors";
import {
  MAX_CAPTAIN_VOTES,
  selectCaptainSeeds,
  validateCaptainVote,
} from "@/lib/captains/rules";

describe("captain voting rules", () => {
  it("rejects voting outside the voting phase", () => {
    expect(
      validateCaptainVote({
        season: { status: "registration", hasCaptainVoting: true },
        voter: approvedRegistration("voter"),
        candidate: captainCandidate("candidate"),
        existingVoteCount: 0,
        alreadyVotedForCandidate: false,
      }),
    ).toBe(ErrorCode.VOTING_CLOSED);
  });

  it("rejects self votes, duplicate votes, ineligible candidates, and over-limit votes", () => {
    const voter = approvedRegistration("same");
    const candidate = captainCandidate("same");

    expect(
      validateCaptainVote({
        season: { status: "voting", hasCaptainVoting: true },
        voter,
        candidate,
        existingVoteCount: 0,
        alreadyVotedForCandidate: false,
      }),
    ).toBe(ErrorCode.VOTE_SELF);

    expect(
      validateCaptainVote({
        season: { status: "voting", hasCaptainVoting: true },
        voter: approvedRegistration("voter"),
        candidate: { ...captainCandidate("candidate"), willingToBeCaptain: false },
        existingVoteCount: 0,
        alreadyVotedForCandidate: false,
      }),
    ).toBe(ErrorCode.CAPTAIN_NOT_ELIGIBLE);

    expect(
      validateCaptainVote({
        season: { status: "voting", hasCaptainVoting: true },
        voter: approvedRegistration("voter"),
        candidate: captainCandidate("candidate"),
        existingVoteCount: MAX_CAPTAIN_VOTES,
        alreadyVotedForCandidate: false,
      }),
    ).toBe(ErrorCode.VOTE_LIMIT_REACHED);

    expect(
      validateCaptainVote({
        season: { status: "voting", hasCaptainVoting: true },
        voter: approvedRegistration("voter"),
        candidate: captainCandidate("candidate"),
        existingVoteCount: 1,
        alreadyVotedForCandidate: true,
      }),
    ).toBe(ErrorCode.VOTE_DUPLICATE);
  });

  it("allows a valid vote", () => {
    expect(
      validateCaptainVote({
        season: { status: "voting", hasCaptainVoting: true },
        voter: approvedRegistration("voter"),
        candidate: captainCandidate("candidate"),
        existingVoteCount: 2,
        alreadyVotedForCandidate: false,
      }),
    ).toBeNull();
  });

  it("selects eight captain seeds by votes, then rating, then registration time", () => {
    const seeds = selectCaptainSeeds([
      seed("low", 2, 2600, "2026-01-01"),
      seed("high", 4, 2200, "2026-01-02"),
      seed("rating-tie-break", 4, 2800, "2026-01-03"),
      seed("early-tie-break", 4, 2800, "2026-01-01"),
      seed("fifth", 1, 3000, "2026-01-01"),
      seed("sixth", 1, 2500, "2026-01-01"),
      seed("seventh", 0, 2900, "2026-01-01"),
      seed("eighth", 0, 2400, "2026-01-01"),
      seed("ninth", 0, 1200, "2026-01-01"),
    ]);

    expect(seeds.map((s) => s.registrationId)).toEqual([
      "early-tie-break",
      "rating-tie-break",
      "high",
      "low",
      "fifth",
      "sixth",
      "seventh",
      "eighth",
    ]);
  });
});

function approvedRegistration(id: string) {
  return {
    id,
    seasonId: "season-a",
    status: "approved",
    willingToBeCaptain: false,
  } as const;
}

function captainCandidate(id: string) {
  return {
    id,
    seasonId: "season-a",
    status: "approved",
    willingToBeCaptain: true,
  } as const;
}

function seed(
  registrationId: string,
  voteCount: number,
  peakRating: number,
  createdAt: string,
) {
  return {
    registrationId,
    voteCount,
    peakRating,
    createdAt: new Date(createdAt),
  };
}
