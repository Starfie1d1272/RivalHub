import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    select: selectMock,
  },
}));

import {
  computeParticipantReadiness,
  getParticipantReadiness,
  getParticipantReadinessBatch,
  isHomeAffiliatedMember,
  loadParticipantQualificationFacts,
  resolveCompetitiveContext,
  toPlayerStrengthInput,
  type ParticipantQualificationFacts,
} from "@/lib/qualification/service";
import type { CompetitiveProfileConfig } from "@/types/season";
import { comparePlayerStrength } from "@/lib/major/player-strength";

const CONTEXT: CompetitiveProfileConfig = {
  platform: "perfect_world",
  currentSeasonKey: "S21",
  previousSeasonKey: "S20",
  rankOrder: ["D", "C", "B", "A", "S"],
};

const USER_ID = "00000000-0000-0000-0000-000000000001";

function userRow(overrides?: Record<string, unknown>) {
  return {
    id: USER_ID,
    displayName: "选手甲",
    perfectName: "perfect-a",
    steamName: "steam-a",
    email: "a@rivalhub.test",
    emailVerifiedAt: new Date(),
    steam64: "76561198000000001",
    qq: "10001",
    ...overrides,
  };
}

function queueFactSelects(options: {
  user?: Record<string, unknown> | null;
  verifications?: unknown[];
  rankFacts?: unknown[];
}) {
  const users = options.user === null ? [] : [userRow(options.user)];
  const verifications = options.verifications ?? [];
  const rankFacts = options.rankFacts ?? [];
  // loadParticipantQualificationFacts issues users → verifications → rank facts selects.
  selectMock.mockImplementationOnce(() => ({
    from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(users) }),
  }));
  selectMock.mockImplementationOnce(() => ({
    from: vi.fn().mockReturnValue({
      innerJoin: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(verifications) }),
    }),
  }));
  selectMock.mockImplementationOnce(() => ({
    from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(rankFacts) }),
  }));
}

beforeEach(() => {
  selectMock.mockReset();
});

describe("qualification facts loader", () => {
  it("loads profile, education history and rank facts in batched queries", async () => {
    queueFactSelects({
      verifications: [{ userId: USER_ID, id: "v1", status: "approved", academicStatus: "enrolled", institutionCode: "4132010284", institutionName: "南京大学", submittedAt: new Date() }],
      rankFacts: [
        { userId: USER_ID, platform: "perfect_world", kind: "historical_peak", platformSeasonKey: null, rank: "S", rating: "1900.00" },
        { userId: USER_ID, platform: "perfect_world", kind: "season_peak", platformSeasonKey: "S20", rank: "A", rating: "1700.00" },
        { userId: USER_ID, platform: "perfect_world", kind: "season_peak", platformSeasonKey: "S21", rank: "S", rating: "1850.00" },
      ],
    });

    const facts = await loadParticipantQualificationFacts([USER_ID]);
    const fact = facts.get(USER_ID)!;
    expect(fact.approvedEducation).toBe(true);
    expect(fact.educationHistory).toHaveLength(1);
    expect(fact.historicalPeak).toMatchObject({ rank: "S", rating: 1900, sourcePlatform: "perfect_world", sourceRank: "S" });
    expect(fact.seasonPeaks?.get("S20")).toMatchObject({ rank: "A", rating: 1700, sourcePlatform: "perfect_world", sourceSeasonKey: "S20", sourceRank: "A" });
    expect(fact.seasonPeaks?.get("S21")).toMatchObject({ rank: "S", rating: 1850, sourcePlatform: "perfect_world", sourceSeasonKey: "S21", sourceRank: "S" });
  });

  it("returns an empty map without issuing queries for an empty roster", async () => {
    const facts = await loadParticipantQualificationFacts([]);
    expect(facts.size).toBe(0);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("skips competitive reads for an education-only fact bundle", async () => {
    queueFactSelects({
      verifications: [{ userId: USER_ID, id: "v1", status: "approved", academicStatus: "enrolled", institutionCode: "4132010284", institutionName: "南京大学", submittedAt: new Date() }],
      rankFacts: [{ userId: USER_ID, platform: "perfect_world", kind: "historical_peak", platformSeasonKey: null, rank: "S", rating: "1900.00" }],
    });

    const facts = await loadParticipantQualificationFacts([USER_ID], { includeCompetitiveFacts: false });

    expect(facts.get(USER_ID)?.approvedEducation).toBe(true);
    expect(facts.get(USER_ID)?.historicalPeak).toBeNull();
    expect(selectMock).toHaveBeenCalledTimes(2);
  });
});

describe("frozen competitive context", () => {
  it("fails closed for a partial published snapshot without querying the live catalog", async () => {
    await expect(resolveCompetitiveContext({ ...CONTEXT, currentSeasonKey: "", rankOrder: [] })).resolves.toBeNull();
    expect(selectMock).not.toHaveBeenCalled();
  });
});

describe("participant readiness", () => {
  const fullFact = (overrides?: Partial<ParticipantQualificationFacts>): ParticipantQualificationFacts => ({
    userId: USER_ID,
    displayName: "选手甲",
    perfectName: "perfect-a",
    steamName: "steam-a",
    email: "a@rivalhub.test",
    emailVerifiedAt: new Date(),
    steam64: "76561198000000001",
    qq: "10001",
    approvedEducation: true,
    educationHistory: [],
    historicalPeak: { rank: "S", rating: 1900 },
    seasonPeaks: new Map([["S20", { rank: "A", rating: 1700 }], ["S21", { rank: "S", rating: 1850 }]]),
    ...overrides,
  });

  it("a complete participant is ready with the frozen event context", () => {
    const readiness = computeParticipantReadiness(fullFact(), CONTEXT);
    expect(readiness.ready).toBe(true);
    expect(readiness.blockers).toEqual([]);
    expect(readiness.strength.previousSeasonPeak).toEqual({ rank: "A", rating: 1700, stars: null });
    expect(readiness.strength.currentSeasonPeak).toEqual({ rank: "S", rating: 1850, stars: null });
  });

  it("blocks a legacy star-rank fact until the participant supplies exact stars", () => {
    const readiness = computeParticipantReadiness(fullFact({
      historicalPeak: { rank: "黄金S", rating: 1900, stars: null },
      seasonPeaks: new Map([[
        "S20", { rank: "A", rating: 1700 },
      ], [
        "S21", { rank: "A", rating: 1850 },
      ]]),
    }), { ...CONTEXT, rankOrder: ["A", "黄金S"] });
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toContain("历史最高的 黄金S 段位需要填写准确星数，竞技资料未填写完整。");
    expect(readiness.findings).toContainEqual(expect.objectContaining({ code: "competitive_profile_incomplete", waivable: false }));
  });

  it("an incomplete participant reports the exact blockers", () => {
    const readiness = computeParticipantReadiness(fullFact({
      steam64: null,
      approvedEducation: false,
      seasonPeaks: new Map(),
    }), CONTEXT);
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toContain("请填写 Steam64 ID。");
    expect(readiness.blockers).toContain("请完成并通过高校身份认证。");
    expect(readiness.blockers).toContain("缺少perfect_world · S20 的最高段位及 Rating。");
    expect(readiness.findings.every((finding) => finding.waivable === false)).toBe(true);
  });

  it("accepts a participant whose canonical Perfect nickname is present", () => {
    const readiness = computeParticipantReadiness(fullFact(), CONTEXT);
    expect(readiness.blockers).not.toContain("请填写完美平台昵称。");
  });

  it("uses an explicitly frozen 5E mapping only when primary season facts are unavailable", () => {
    const context: CompetitiveProfileConfig = {
      ...CONTEXT,
      fallbackConversion: {
        sourcePlatform: "fivee",
        version: "major-2026-v1",
        seasonKeyMap: { S20: "5E-S20", S21: "5E-S21" },
        mapping: { belowSRankMap: { A: "A", B: "B" }, starSegments: [{minStar:0,maxStar:null,targetRank:"A",targetStarFloor:null,slopeNum:0,slopeDen:1}], relativeSeasonAlignment: true },
      },
    };
    const readiness = computeParticipantReadiness(fullFact({
      seasonPeaks: new Map([["S20", { status: "unranked", rank: null, rating: null }], ["S21", { status: "unranked", rank: null, rating: null }]]),
      fallbackFacts: {
        historicalPeak: null,
        seasonPeaks: new Map([["5E-S20", { rank: "A", rating: 1700 }], ["5E-S21", { rank: "B", rating: 1850 }]]),
      },
    }), context);
    expect(readiness.ready).toBe(true);
    expect(readiness.strength.previousSeasonPeak).toMatchObject({ rank: "A", rating: 0, ratingComparable: false, sourcePlatform: "fivee", sourceSeasonKey: "5E-S20", sourceRank: "A", conversionVersion: "major-2026-v1" });
    expect(readiness.strength.currentSeasonPeak).toMatchObject({ rank: "B", rating: 0, ratingComparable: false, sourcePlatform: "fivee", sourceSeasonKey: "5E-S21", sourceRank: "B", conversionVersion: "major-2026-v1" });
  });

  it("fails closed for an unmapped evidence season instead of guessing an identically named 5E season", async () => {
    const context: CompetitiveProfileConfig = {
      ...CONTEXT,
      fallbackConversion: {
        sourcePlatform: "fivee",
        version: "major-2026-v1",
        seasonKeyMap: { S20: "5E-S20" },
        mapping: { belowSRankMap: { S: "A" }, starSegments: [{minStar:0,maxStar:null,targetRank:"A",targetStarFloor:null,slopeNum:0,slopeDen:1}], relativeSeasonAlignment: true },
      },
    };
    await expect(resolveCompetitiveContext(context)).resolves.toBeNull();
    const strength = toPlayerStrengthInput(fullFact({
      seasonPeaks: new Map(),
      fallbackFacts: { historicalPeak: null, seasonPeaks: new Map([["S21", { rank: "S", rating: 2200 }]]) },
    }), context);
    expect(strength.currentSeasonPeak).toBeNull();
  });

  it("never compares a 5E Rating+ as though it were a Perfect Rating Pro", () => {
    const context: CompetitiveProfileConfig = {
      ...CONTEXT,
      fallbackConversion: {
        sourcePlatform: "fivee",
        version: "major-2026-v1",
        seasonKeyMap: { S20: "5E-S20", S21: "5E-S21" },
        mapping: { belowSRankMap: { A: "A" }, starSegments: [{minStar:0,maxStar:null,targetRank:"A",targetStarFloor:null,slopeNum:0,slopeDen:1}], relativeSeasonAlignment: true },
      },
    };
    const fallback = toPlayerStrengthInput(fullFact({
      historicalPeak: null,
      seasonPeaks: new Map(),
      fallbackFacts: {
        historicalPeak: { rank: "A", rating: 2100 },
        seasonPeaks: new Map([["5E-S20", { rank: "A", rating: 2100 }], ["5E-S21", { rank: "A", rating: 2100 }]]),
      },
    }), context);
    const perfect = toPlayerStrengthInput(fullFact({
      historicalPeak: { rank: "A", rating: 1.18 },
      seasonPeaks: new Map([["S20", { rank: "A", rating: 1.18 }], ["S21", { rank: "A", rating: 1.18 }]]),
    }), context);
    expect(comparePlayerStrength(fallback, perfect, context)).toMatchObject({ order: 0, reason: "所有规则指定的比较项均相同，视为实力相当。" });
  });

  it("single-user readiness delegates to the batch path with identical results", async () => {
    queueFactSelects({
      verifications: [],
      rankFacts: [
        { userId: USER_ID, platform: "perfect_world", kind: "historical_peak", platformSeasonKey: null, rank: "B", rating: "1500.00" },
      ],
    });
    const single = await getParticipantReadiness(USER_ID, CONTEXT);

    queueFactSelects({
      verifications: [],
      rankFacts: [
        { userId: USER_ID, platform: "perfect_world", kind: "historical_peak", platformSeasonKey: null, rank: "B", rating: "1500.00" },
      ],
    });
    const batch = await getParticipantReadinessBatch([USER_ID], CONTEXT);

    expect(batch.get(USER_ID)).toEqual(single);
    expect(single.ready).toBe(false);
    expect(single.blockers.join(" ")).toContain("缺少perfect_world · S20 的最高段位及 Rating");
  });

  it("uses a preloaded fact bundle without issuing a second read", async () => {
    const fact: ParticipantQualificationFacts = {
      userId: USER_ID,
      displayName: "选手甲",
      perfectName: "perfect-a",
      steamName: "steam-a",
      email: "a@rivalhub.test",
      emailVerifiedAt: new Date(),
      steam64: "76561198000000001",
      qq: "10001",
      approvedEducation: true,
      educationHistory: [],
      historicalPeak: { rank: "A", rating: 1500 },
      seasonPeaks: new Map([
        ["S20", { rank: "A", rating: 1500 }],
        ["S21", { rank: "A", rating: 1500 }],
      ]),
    };

    const readiness = await getParticipantReadinessBatch([USER_ID], CONTEXT, { facts: new Map([[USER_ID, fact]]) });

    expect(readiness.get(USER_ID)?.ready).toBe(true);
    expect(selectMock).not.toHaveBeenCalled();
  });
});

describe("isHomeAffiliatedMember", () => {
  const rules = [{
    institutionCode: "4132010284",
    eligibleAcademicStatuses: ["enrolled", "graduated"] as const,
    minRosterMembers: 3,
    minStartingMembers: 3,
  }];

  it("matches institution code and eligible academic status", () => {
    expect(isHomeAffiliatedMember({ institutionCode: "4132010284", academicStatus: "enrolled" }, rules)).toBe(true);
    expect(isHomeAffiliatedMember({ institutionCode: "4132010284", academicStatus: null }, rules)).toBe(false);
    expect(isHomeAffiliatedMember({ institutionCode: "9999999999", academicStatus: "enrolled" }, rules)).toBe(false);
  });
});
