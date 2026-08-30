import { describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", () => ({ db: {} }));

import { buildMyReadinessModel, selectMyCompetitiveProfilePlatformKeys, type MyCompetitionSource, type MySanctionSource } from "@/lib/my/readiness";
import type { SanctionEffect } from "@/lib/discipline/service";
import type { ParticipantQualificationFacts } from "@/lib/qualification/service";
import { MAJOR_TEAM_CONFIG } from "@/types/season";

const USER_ID = "00000000-0000-0000-0000-000000000001";
const CONTEXT = { platform: "perfect_world", previousSeasonKey: "S20", currentSeasonKey: "S21", rankOrder: ["A", "S"] };

function fullFact(overrides: Partial<ParticipantQualificationFacts> = {}): ParticipantQualificationFacts {
  return {
    userId: USER_ID,
    displayName: "选手甲",
    perfectName: "perfect-a",
    steamName: "steam-a",
    email: "a@example.test",
    emailVerifiedAt: new Date("2026-08-01T00:00:00Z"),
    steam64: "76561198000000001",
    perfectId: "10001",
    qq: "12345",
    approvedEducation: true,
    educationHistory: [],
    historicalPeak: { rank: "S", rating: 1900 },
    seasonPeaks: new Map([["S20", { rank: "A", rating: 1600 }], ["S21", { rank: "S", rating: 1800 }]]),
    ...overrides,
  };
}

function competition(overrides: Partial<MyCompetitionSource> = {}): MyCompetitionSource {
  return {
    id: "entry-1",
    name: "RivalHub Alpha",
    seasonId: "season-1",
    seasonName: "2026 秋季赛",
    seasonSlug: "major-2026",
    registrationStatus: "approved",
    participantStatus: "confirmed",
    representativeUserId: USER_ID,
    teamRegistrationConfig: { ...MAJOR_TEAM_CONFIG, competitiveProfile: CONTEXT },
    ...overrides,
  };
}

function sanction(effects: SanctionEffect[]): MySanctionSource {
  return {
    id: `case-${effects[0]}`,
    seasonId: "season-1",
    seasonName: "2026 秋季赛",
    seasonSlug: "major-2026",
    effects,
    explanation: "公开说明",
    effectiveFrom: new Date("2026-08-01T00:00:00Z"),
    effectiveUntil: null,
  };
}

function model(overrides: Partial<Parameters<typeof buildMyReadinessModel>[0]> = {}) {
  const fact = fullFact();
  return buildMyReadinessModel({
    user: fact,
    baseFact: fact,
    currentTeam: { id: "team-1", name: "Rival Five", role: "captain" },
    competitiveProfiles: [{ key: "perfect_world", displayName: "完美世界竞技", state: "ready", blockers: [] }],
    competitions: [competition()],
    qualificationFactsByPlatform: new Map([["perfect_world", fact]]),
    sanctions: [],
    userId: USER_ID,
    ...overrides,
  });
}

describe("我的 readiness read model", () => {
  it("keeps a fully prepared profile separate from the approved CompetitionEntry", () => {
    const result = model();

    expect(result.profile.state).toBe("ready");
    expect(result.education.state).toBe("ready");
    expect(result.competitiveProfiles[0]?.state).toBe("ready");
    expect(result.team.state).toBe("ready");
    expect(result.competitions[0]?.entry.state).toBe("ready");
    expect(result.competitions[0]?.qualification.state).toBe("ready");
    expect(result.competitions[0]?.qualification.detail).toContain("仍单独决定 event eligibility");
  });

  it("routes missing education and incomplete competitive facts to their own owners", () => {
    const missingEducation = fullFact({ approvedEducation: false, educationHistory: [] });
    const incompleteCompetitive = fullFact({ seasonPeaks: new Map() });
    const result = model({
      baseFact: missingEducation,
      competitiveProfiles: [{ key: "perfect_world", displayName: "完美世界竞技", state: "incomplete", blockers: ["缺少上赛季最高段位及 Rating。"] }],
      qualificationFactsByPlatform: new Map([["perfect_world", incompleteCompetitive]]),
    });

    expect(result.education).toMatchObject({ state: "incomplete", owner: "我", cta: { href: "/settings/education" } });
    expect(result.competitiveProfiles[0]).toMatchObject({ state: "incomplete" });
    expect(result.competitions[0]?.qualification).toMatchObject({ state: "blocked", owner: "我" });
  });

  it.each([
    ["submitted", "waiting"],
    ["changes_requested", "blocked"],
    ["approved", "ready"],
  ] as const)("maps CompetitionEntry %s to an explicit user-visible state", (registrationStatus, state) => {
    const result = model({ competitions: [competition({ registrationStatus })] });
    expect(result.competitions[0]?.entry.state).toBe(state);
  });

  it("keeps changes_requested invited members on the shared reconfirmation presentation", () => {
    const result = model({
      competitions: [competition({
        representativeUserId: "another-user",
        registrationStatus: "changes_requested",
        participantStatus: "invited",
      })],
    });

    expect(result.competitions[0]?.entry).toMatchObject({ state: "waiting", owner: "我" });
    expect(result.competitions[0]?.entry.detail).toContain("需要重新确认");
  });

  it.each([
    ["approved", "ready"],
    ["submitted", "waiting"],
    ["waitlisted", "waiting"],
    ["changes_requested", "blocked"],
    ["rejected", "blocked"],
    ["withdrawn", "blocked"],
    ["draft", "incomplete"],
  ] as const)("combines a confirmed member with Entry %s instead of reporting the Entry ready", (registrationStatus, state) => {
    const result = model({
      competitions: [competition({
        representativeUserId: "another-user",
        registrationStatus,
        participantStatus: "confirmed",
      })],
    });

    expect(result.competitions[0]?.entry.state).toBe(state);
    expect(result.competitions[0]?.entry.detail).toContain("已确认参赛");
  });

  it("only selects required platforms and platforms with user facts for readiness cards", () => {
    const catalog = [
      { key: "perfect", displayName: "Perfect", ratingLabel: "Rating", ranks: [], seasons: [] },
      { key: "5e", displayName: "5E", ratingLabel: "Rating", ranks: [], seasons: [] },
    ];

    expect(selectMyCompetitiveProfilePlatformKeys(catalog, new Set(["perfect"]), new Set())).toEqual(["perfect"]);
    expect(selectMyCompetitiveProfilePlatformKeys(catalog, new Set(["perfect"]), new Set(["5e"]))).toEqual(["perfect", "5e"]);
  });

  it("surfaces every active sanction effect with the affected competition", () => {
    const sanctions = [sanction(["registration_block"]), sanction(["roster_block"]), sanction(["match_participation_block"])];
    const result = model({ sanctions });

    expect(result.sanctions).toHaveLength(3);
    expect(result.competitions[0]?.sanctions.map((entry) => entry.effects[0])).toEqual([
      "registration_block", "roster_block", "match_participation_block",
    ]);
  });

  it("fails closed when profile or event qualification facts are unavailable", () => {
    const result = model({
      baseFact: null,
      user: { displayName: null, perfectName: null, steamName: null },
      competitiveProfiles: [{ key: "perfect_world", displayName: "完美世界竞技", state: "unknown", blockers: ["竞技档案事实不可确认。"] }],
      qualificationFactsByPlatform: new Map([["perfect_world", null]]),
      currentTeam: null,
    });

    expect(result.profile.state).toBe("unknown");
    expect(result.education.state).toBe("unknown");
    expect(result.team.state).toBe("incomplete");
    expect(result.competitions[0]?.qualification.state).toBe("unknown");
    expect(result.competitions[0]?.qualification.state).not.toBe("ready");
  });
});
