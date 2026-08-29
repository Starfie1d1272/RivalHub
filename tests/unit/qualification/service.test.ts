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
  type ParticipantQualificationFacts,
} from "@/lib/qualification/service";
import type { CompetitiveProfileConfig } from "@/types/season";

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
    perfectId: "1000001",
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
    expect(fact.historicalPeak).toEqual({ rank: "S", rating: 1900 });
    expect(fact.seasonPeaks?.get("S20")).toEqual({ rank: "A", rating: 1700 });
    expect(fact.seasonPeaks?.get("S21")).toEqual({ rank: "S", rating: 1850 });
  });

  it("returns an empty map without issuing queries for an empty roster", async () => {
    const facts = await loadParticipantQualificationFacts([]);
    expect(facts.size).toBe(0);
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
    perfectId: "1000001",
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
    expect(readiness.strength.previousSeasonPeak).toEqual({ rank: "A", rating: 1700 });
    expect(readiness.strength.currentSeasonPeak).toEqual({ rank: "S", rating: 1850 });
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
    expect(readiness.blockers).toContain("缺少上赛季最高段位及 Rating。");
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
    expect(single.blockers.join(" ")).toContain("缺少上赛季最高段位及 Rating");
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
