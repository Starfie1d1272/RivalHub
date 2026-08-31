import { describe, expect, it } from "vitest";
import {
  serializePublicCaptainCandidate,
} from "@/lib/captains/data";
import {
  serializePublicDraftPlayer,
} from "@/lib/draft/data";
import { serializePublicMatchTimeProposal } from "@/lib/matches/time-proposals";

const PRIVATE_KEYS = [
  "email",
  "qq",
  "studentId",
  "authId",
  "seasonIds",
  "internalEvidence",
  "notes",
  "competitionHistory",
  "gameplayStyle",
];

describe("public payload serializers", () => {
  it("does not copy private columns into the public captains DTO", () => {
    const source = {
      id: "registration-1",
      displayName: null,
      perfectName: "PerfectPlayer",
      steamName: "SteamPlayer",
      primaryPosition: "igl",
      peakRank: "S",
      peakRating: 2.1,
      currentRating: 2.05,
      voteCount: 3,
      email: "captain@example.test",
      qq: "123456",
      studentId: "20260001",
      authId: "auth-private",
      seasonIds: ["season-private"],
      internalEvidence: "private evidence",
    };

    const serialized = serializePublicCaptainCandidate(source);

    expect(serialized).toEqual({
      id: "registration-1",
      displayName: "PerfectPlayer",
      primaryPosition: "igl",
      peakRank: "S",
      peakRating: 2.1,
      currentRating: 2.05,
      voteCount: 3,
    });
    expect(JSON.stringify(serialized)).not.toContain("captain@example.test");
    for (const key of PRIVATE_KEYS) {
      expect(Object.hasOwn(serialized, key), key).toBe(false);
    }
  });

  it("keeps the anonymous draft payload free of private registration fields", () => {
    const source = {
      registrationId: "registration-2",
      userId: "user-2",
      steamName: "SteamPlayer",
      perfectName: null,
      displayName: "PublicPlayer",
      primaryPosition: "awper",
      secondaryPosition: "anchor",
      peakRank: "A+",
      peakRating: 1.8,
      currentRank: "A",
      currentRating: 1.7,
      mapPreferences: [],
      email: "player@example.test",
      qq: "654321",
      studentId: "20260002",
      authId: "auth-private",
      seasonIds: ["season-private"],
      internalEvidence: "private evidence",
      notes: "时间冲突",
      gameplayStyle: "进攻型",
      competitionHistory: "校赛",
    };

    const payload = {
      captains: {
        candidates: [serializePublicCaptainCandidate({
          id: source.registrationId,
          displayName: source.displayName,
          perfectName: source.perfectName,
          steamName: source.steamName,
          primaryPosition: source.primaryPosition,
          peakRank: source.peakRank,
          peakRating: source.peakRating,
          currentRating: source.currentRating,
          voteCount: 0,
        })],
      },
      draft: {
        remainingPlayers: [serializePublicDraftPlayer(source)],
      },
    };
    const serializedPayload = JSON.stringify(payload);

    expect(serializedPayload).not.toContain("player@example.test");
    for (const key of PRIVATE_KEYS) {
      expect(serializedPayload).not.toContain(`"${key}"`);
    }
  });

  it("does not expose proposal actor identifiers to the public match view", () => {
    const now = new Date("2026-08-29T00:00:00.000Z");
    const serialized = serializePublicMatchTimeProposal(
      {
        id: "proposal-1",
        status: "pending",
        proposedTime: now,
        responseAt: null,
        rejectReason: null,
        createdAt: now,
        proposedBy: "user-private",
      },
      "user-private",
    );

    expect(serialized).toEqual({
      id: "proposal-1",
      status: "pending",
      proposedTime: now,
      responseAt: null,
      rejectReason: null,
      createdAt: now,
      isMine: true,
    });
    expect(JSON.stringify(serialized)).not.toContain("user-private");
    expect(Object.hasOwn(serialized, "proposedBy")).toBe(false);
    expect(Object.hasOwn(serialized, "forceAssignedBy")).toBe(false);
  });
});
