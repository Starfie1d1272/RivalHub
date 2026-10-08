import { describe, expect, it } from "vitest";
import { MAX_CAPTAIN_VOTES, selectCaptainSeeds, validateCaptainVote, type ValidateCaptainVoteInput } from "@/lib/captains/rules";
import { ErrorCode } from "@/lib/errors";

describe("validateCaptainVote", () => {
  const validSeason = {
    status: "voting",
    hasCaptainVoting: true,
  };
  const approvedVoter = {
    id: "voter1",
    seasonId: "s1",
    status: "approved",
    willingToBeCaptain: true,
  };
  const approvedCandidate = {
    id: "candidate1",
    seasonId: "s1",
    status: "approved",
    willingToBeCaptain: true,
  };

  function voteInput(
    overrides: Partial<ValidateCaptainVoteInput>,
  ): ValidateCaptainVoteInput {
    return {
      season: validSeason,
      voter: approvedVoter,
      candidate: approvedCandidate,
      existingVoteCount: 0,
      alreadyVotedForCandidate: false,
      ...overrides,
    };
  }

  it("returns null for valid vote", () => {
    expect(validateCaptainVote(voteInput({}))).toBeNull();
  });

  it("rejects when voting is closed (wrong status)", () => {
    expect(
      validateCaptainVote(
        voteInput({ season: { status: "registration", hasCaptainVoting: true } }),
      ),
    ).toBe(ErrorCode.VOTING_CLOSED);
  });

  it("rejects when season lacks captain voting", () => {
    expect(
      validateCaptainVote(
        voteInput({ season: { status: "voting", hasCaptainVoting: false } }),
      ),
    ).toBe(ErrorCode.VOTING_CLOSED);
  });

  it("rejects when voter is not approved", () => {
    expect(
      validateCaptainVote(
        voteInput({
          voter: { ...approvedVoter, status: "pending" },
        }),
      ),
    ).toBe(ErrorCode.FORBIDDEN);
  });

  it("rejects when candidate is not approved", () => {
    expect(
      validateCaptainVote(
        voteInput({
          candidate: { ...approvedCandidate, status: "pending" },
        }),
      ),
    ).toBe(ErrorCode.CAPTAIN_NOT_ELIGIBLE);
  });

  it("rejects when candidate is not willing to be captain", () => {
    expect(
      validateCaptainVote(
        voteInput({
          candidate: { ...approvedCandidate, willingToBeCaptain: false },
        }),
      ),
    ).toBe(ErrorCode.CAPTAIN_NOT_ELIGIBLE);
  });

  it("rejects self-vote", () => {
    expect(
      validateCaptainVote(
        voteInput({ voter: approvedVoter, candidate: approvedVoter }),
      ),
    ).toBe(ErrorCode.VOTE_SELF);
  });

  it("rejects when vote limit reached", () => {
    expect(
      validateCaptainVote(
        voteInput({ existingVoteCount: MAX_CAPTAIN_VOTES }),
      ),
    ).toBe(ErrorCode.VOTE_LIMIT_REACHED);
  });

  it("rejects duplicate vote", () => {
    expect(
      validateCaptainVote(
        voteInput({ alreadyVotedForCandidate: true }),
      ),
    ).toBe(ErrorCode.VOTE_DUPLICATE);
  });

  it("rejects when candidate is in different season", () => {
    expect(
      validateCaptainVote(
        voteInput({
          candidate: { ...approvedCandidate, seasonId: "s2" },
        }),
      ),
    ).toBe(ErrorCode.CAPTAIN_NOT_ELIGIBLE);
  });
});

describe("captain seeding", () => {
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
