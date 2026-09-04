import { beforeEach, describe, expect, it, vi } from "vitest";

const { fallbackCatalogReferencesExistMock, resolveLiveCompetitiveContextMock } = vi.hoisted(() => ({
  fallbackCatalogReferencesExistMock: vi.fn(),
  resolveLiveCompetitiveContextMock: vi.fn(),
}));

vi.mock("@/lib/competitive/catalog", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/competitive/catalog")>();
  return { ...original, fallbackCatalogReferencesExist: fallbackCatalogReferencesExistMock, resolveLiveCompetitiveContext: resolveLiveCompetitiveContextMock };
});

import { freezeCompetitiveContext, resolveConversionPolicyForPublish } from "@/lib/seasons/lifecycle";

type SeasonArg = Parameters<typeof freezeCompetitiveContext>[1];

const selectMock = vi.fn();
const tx = { select: selectMock } as unknown as Parameters<typeof freezeCompetitiveContext>[0];

const PERFECT_CONTEXT = {
  platform: "perfect_world",
  currentSeasonKey: "s21",
  previousSeasonKey: "s20",
  priorSeasonKey: "s19",
  rankOrder: ["bronze", "silver", "gold"],
};
const FIVE_CONTEXT = {
  platform: "fivee",
  currentSeasonKey: "5e-s21",
  previousSeasonKey: "5e-s20",
  priorSeasonKey: "5e-s19",
  rankOrder: ["bronze", "silver", "gold"],
};

const POLICY = {
  sourcePlatform: "fivee",
  targetPlatform: "perfect_world",
  version: "2026.09",
  status: "approved",
  mapping: {
    belowSRankMap: { bronze: "bronze" },
    starSegments: [{ minStar: 0, maxStar: null, targetRank: "silver", targetStarFloor: null, slopeNum: 0, slopeDen: 1 }],
    relativeSeasonAlignment: true,
  },
};

function mockPolicySelect(rows: unknown[]) {
  selectMock.mockReturnValue({
    from: () => ({
      where: () => ({
        orderBy: () => ({
          limit: async () => rows,
        }),
        limit: async () => rows,
      }),
    }),
  });
}

const majorSeason = (platform: string): SeasonArg => ({
  id: "season-1",
  competitionTemplate: "major",
  teamRegistrationConfig: {
    requireCompetitiveProfile: true,
    competitiveProfile: { platform, currentSeasonKey: "", previousSeasonKey: "", rankOrder: [] },
  },
}) as unknown as SeasonArg;

beforeEach(() => {
  resolveLiveCompetitiveContextMock.mockReset();
  fallbackCatalogReferencesExistMock.mockReset();
  fallbackCatalogReferencesExistMock.mockResolvedValue(true);
  selectMock.mockReset();
  mockPolicySelect([]);
});

describe("freezeCompetitiveContext", () => {
  it("freezes an event-owned three-season evidence policy and platform ladder", async () => {
    resolveLiveCompetitiveContextMock.mockResolvedValue(PERFECT_CONTEXT);
    const config = await freezeCompetitiveContext(tx, majorSeason("perfect_world"));
    expect(config.competitiveProfile).toEqual({
      platform: "perfect_world",
      currentSeasonKey: "s21",
      previousSeasonKey: "s20",
      rankOrder: ["bronze", "silver", "gold"],
      evidencePolicy: {
        historicalWeight: 50,
        referenceSeasonKey: "s19",
        referenceSeasonWeight: 20,
        recentSeasonKeys: ["s20", "s21"],
        recentSeasonWeight: 30,
      },
    });
  });

  it("defaults the platform to perfect_world when the draft carries none", async () => {
    resolveLiveCompetitiveContextMock.mockResolvedValue(PERFECT_CONTEXT);
    const season = majorSeason("perfect_world");
    season.teamRegistrationConfig.competitiveProfile = undefined;
    await freezeCompetitiveContext(tx, season);
    expect(resolveLiveCompetitiveContextMock).toHaveBeenCalledWith(tx, "perfect_world");
  });

  it("fails closed when the catalog is incomplete instead of using a fallback", async () => {
    resolveLiveCompetitiveContextMock.mockResolvedValue(null);
    await expect(freezeCompetitiveContext(tx, majorSeason("perfect_world"))).rejects.toThrow(
      "请先在竞技平台目录中",
    );
  });

  it("freezes the current approved conversion policy with relative season alignment", async () => {
    resolveLiveCompetitiveContextMock
      .mockResolvedValueOnce(PERFECT_CONTEXT)
      .mockResolvedValueOnce(FIVE_CONTEXT);
    mockPolicySelect([POLICY]);
    const config = await freezeCompetitiveContext(tx, majorSeason("perfect_world"));
    expect(config.competitiveProfile!.fallbackConversion).toEqual({
      sourcePlatform: "fivee",
      version: "2026.09",
      seasonKeyMap: { s21: "5e-s21", s20: "5e-s20", s19: "5e-s19" },
      mapping: POLICY.mapping,
    });
  });

  it("omits the fallback when no approved policy exists", async () => {
    resolveLiveCompetitiveContextMock.mockResolvedValue(PERFECT_CONTEXT);
    const config = await freezeCompetitiveContext(tx, majorSeason("perfect_world"));
    expect(config.competitiveProfile!.fallbackConversion).toBeUndefined();
  });

  it("refuses a frozen fallback when its 5E source identities no longer exist in the catalog", async () => {
    resolveLiveCompetitiveContextMock
      .mockResolvedValueOnce(PERFECT_CONTEXT)
      .mockResolvedValueOnce(FIVE_CONTEXT);
    fallbackCatalogReferencesExistMock.mockResolvedValue(false);
    mockPolicySelect([POLICY]);
    await expect(freezeCompetitiveContext(tx, majorSeason("perfect_world"))).rejects.toThrow("5E fallback 映射引用的赛季或段位已不在竞技目录中");
  });

  it("passes seasons without a competitive-profile requirement through untouched", async () => {
    const season = {
      id: "season-1",
      competitionTemplate: "major",
      teamRegistrationConfig: { requireCompetitiveProfile: false },
    } as unknown as SeasonArg;
    const config = await freezeCompetitiveContext(tx, season);
    expect(config.competitiveProfile).toBeUndefined();
    expect(resolveLiveCompetitiveContextMock).not.toHaveBeenCalled();
  });

  it("freezes the specific policy locked at publish even if another policy is approved later", async () => {
    resolveLiveCompetitiveContextMock
      .mockResolvedValueOnce(PERFECT_CONTEXT)
      .mockResolvedValueOnce(FIVE_CONTEXT);
    const LOCKED_POLICY = {
      id: "policy-locked",
      sourcePlatform: "fivee",
      targetPlatform: "perfect_world",
      version: "2026.09",
      status: "approved",
      mapping: POLICY.mapping,
    };
    mockPolicySelect([LOCKED_POLICY]);
    const season = majorSeason("perfect_world");
    season.teamRegistrationConfig.competitiveProfile = {
      platform: "perfect_world",
      currentSeasonKey: "",
      previousSeasonKey: "",
      rankOrder: [],
      conversionPolicyVersion: "2026.09",
      conversionPolicyId: "policy-locked",
    };
    const config = await freezeCompetitiveContext(tx, season);
    expect(config.competitiveProfile!.fallbackConversion).toEqual({
      sourcePlatform: "fivee",
      version: "2026.09",
      seasonKeyMap: { s21: "5e-s21", s20: "5e-s20", s19: "5e-s19" },
      mapping: POLICY.mapping,
    });
    expect(config.competitiveProfile!.conversionPolicyVersion).toBe("2026.09");
    expect(config.competitiveProfile!.conversionPolicyId).toBe("policy-locked");
  });

  it("fails closed when the locked policy has been retired", async () => {
    resolveLiveCompetitiveContextMock.mockResolvedValue(PERFECT_CONTEXT);
    const RETIRED_POLICY = {
      id: "policy-retired",
      sourcePlatform: "fivee",
      targetPlatform: "perfect_world",
      version: "2026.09",
      status: "retired",
      mapping: POLICY.mapping,
    };
    mockPolicySelect([RETIRED_POLICY]);
    const season = majorSeason("perfect_world");
    season.teamRegistrationConfig.competitiveProfile = {
      platform: "perfect_world",
      currentSeasonKey: "",
      previousSeasonKey: "",
      rankOrder: [],
      conversionPolicyVersion: "2026.09",
    };
    await expect(freezeCompetitiveContext(tx, season)).rejects.toThrow("只有 approved 策略可以开放报名");
  });

  it("fails closed when the locked policy is not found", async () => {
    resolveLiveCompetitiveContextMock.mockResolvedValue(PERFECT_CONTEXT);
    mockPolicySelect([]);
    const season = majorSeason("perfect_world");
    season.teamRegistrationConfig.competitiveProfile = {
      platform: "perfect_world",
      currentSeasonKey: "",
      previousSeasonKey: "",
      rankOrder: [],
      conversionPolicyVersion: "nonexistent-version",
    };
    await expect(freezeCompetitiveContext(tx, season)).rejects.toThrow("赛事选用的 5E 换算策略版本 (nonexistent-version) 不存在");
  });

  it("fails closed when 5E context lacks prior season for relative season alignment", async () => {
    resolveLiveCompetitiveContextMock
      .mockResolvedValueOnce(PERFECT_CONTEXT)
      .mockResolvedValueOnce({ ...FIVE_CONTEXT, priorSeasonKey: null });
    mockPolicySelect([POLICY]);
    await expect(freezeCompetitiveContext(tx, majorSeason("perfect_world"))).rejects.toThrow("无法完成相对赛季对齐");
  });
});

describe("resolveConversionPolicyForPublish", () => {
  it("resolves the current active approved policy by default", async () => {
    const ACTIVE_POLICY = { id: "p1", version: "2026.09", isCurrent: true, status: "approved" };
    mockPolicySelect([ACTIVE_POLICY]);
    const result = await resolveConversionPolicyForPublish(tx, "perfect_world");
    expect(result).toEqual({ id: "p1", version: "2026.09" });
  });

  it("resolves an explicitly requested approved policy version", async () => {
    const REQUESTED = { id: "p2", version: "2026.08", status: "approved" };
    mockPolicySelect([REQUESTED]);
    const result = await resolveConversionPolicyForPublish(tx, "perfect_world", undefined, "2026.08");
    expect(result).toEqual({ id: "p2", version: "2026.08" });
  });

  it("fails closed if the requested policy is retired", async () => {
    const RETIRED = { id: "p2", version: "2026.08", status: "retired" };
    mockPolicySelect([RETIRED]);
    await expect(resolveConversionPolicyForPublish(tx, "perfect_world", undefined, "2026.08")).rejects.toThrow("尚未启用或已被废弃");
  });

  it("fails closed if the requested policy is not found", async () => {
    mockPolicySelect([]);
    await expect(resolveConversionPolicyForPublish(tx, "perfect_world", undefined, "2099.99")).rejects.toThrow("不存在");
  });

  it("fails closed if no approved policy exists at all", async () => {
    mockPolicySelect([]);
    await expect(resolveConversionPolicyForPublish(tx, "perfect_world")).rejects.toThrow("未找到已启用的 5E 换算策略");
  });
});
