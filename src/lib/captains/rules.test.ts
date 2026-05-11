import { describe, it, expect } from "vitest";
import {
  selectCaptainSeeds,
  compareCaptainSeedCandidates,
  validateCaptainVote,
  CAPTAIN_TEAM_COUNT,
  MAX_CAPTAIN_VOTES,
} from "@/lib/captains/rules";
import { ErrorCode } from "@/lib/errors";
import type {
  CaptainSeedCandidate,
  ValidateCaptainVoteInput,
} from "@/lib/captains/rules";

function candidate(overrides: {
  registrationId?: string;
  voteCount?: number;
  peakRating?: number;
  createdAt?: Date;
}): CaptainSeedCandidate {
  return {
    registrationId: overrides.registrationId ?? "r1",
    voteCount: overrides.voteCount ?? 0,
    peakRating: overrides.peakRating ?? 1.0,
    createdAt: overrides.createdAt ?? new Date("2025-01-01"),
  };
}

describe("selectCaptainSeeds", () => {
  it("returns top CAPTAIN_TEAM_COUNT candidates", () => {
    expect(CAPTAIN_TEAM_COUNT).toBe(8);
  });

  it("selects top candidates by voteCount, then peakRating, then createdAt", () => {
    const candidates = [
      candidate({ registrationId: "low", voteCount: 1 }),
      candidate({
        registrationId: "high",
        voteCount: 10,
        peakRating: 2.0,
        createdAt: new Date("2025-06-01"),
      }),
      candidate({
        registrationId: "mid",
        voteCount: 5,
        peakRating: 1.5,
        createdAt: new Date("2025-03-01"),
      }),
    ];

    const selected = selectCaptainSeeds(candidates);
    expect(selected.map((c) => c.registrationId)).toEqual([
      "high",
      "mid",
      "low",
    ]);
  });
});

describe("compareCaptainSeedCandidates", () => {
  it("ranks higher voteCount first", () => {
    const a = candidate({ registrationId: "a", voteCount: 5 });
    const b = candidate({ registrationId: "b", voteCount: 3 });
    expect(compareCaptainSeedCandidates(a, b)).toBeLessThan(0);
    expect(compareCaptainSeedCandidates(b, a)).toBeGreaterThan(0);
  });

  it("breaks ties with peakRating", () => {
    const a = candidate({ registrationId: "a", voteCount: 5, peakRating: 2.5 });
    const b = candidate({ registrationId: "b", voteCount: 5, peakRating: 2.0 });
    expect(compareCaptainSeedCandidates(a, b)).toBeLessThan(0);
  });

  it("breaks further ties with createdAt (earlier first)", () => {
    const a = candidate({
      registrationId: "a",
      voteCount: 5,
      peakRating: 2.0,
      createdAt: new Date("2025-01-01"),
    });
    const b = candidate({
      registrationId: "b",
      voteCount: 5,
      peakRating: 2.0,
      createdAt: new Date("2025-06-01"),
    });
    expect(compareCaptainSeedCandidates(a, b)).toBeLessThan(0);
  });
});

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
