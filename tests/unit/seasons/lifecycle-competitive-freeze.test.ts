import { beforeEach, describe, expect, it, vi } from "vitest";

const { fallbackCatalogReferencesExistMock, resolveLiveCompetitiveContextMock } = vi.hoisted(() => ({
  fallbackCatalogReferencesExistMock: vi.fn(),
  resolveLiveCompetitiveContextMock: vi.fn(),
}));

vi.mock("@/lib/competitive/catalog", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/competitive/catalog")>();
  return { ...original, fallbackCatalogReferencesExist: fallbackCatalogReferencesExistMock, resolveLiveCompetitiveContext: resolveLiveCompetitiveContextMock };
});

import { freezeCompetitiveContext } from "@/lib/seasons/lifecycle";

type SeasonArg = Parameters<typeof freezeCompetitiveContext>[1];
const tx = {} as Parameters<typeof freezeCompetitiveContext>[0];

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
});

describe("freezeCompetitiveContext", () => {
  it("freezes an event-owned three-season evidence policy and platform ladder", async () => {
    resolveLiveCompetitiveContextMock.mockResolvedValue({
      platform: "perfect_world",
      currentSeasonKey: "s21",
      previousSeasonKey: "s20",
      priorSeasonKey: "s19",
      rankOrder: ["bronze", "silver", "gold"],
    });
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
    resolveLiveCompetitiveContextMock.mockResolvedValue({
      platform: "perfect_world",
      currentSeasonKey: "s21",
      previousSeasonKey: "s20",
      priorSeasonKey: "s19",
      rankOrder: ["bronze"],
    });
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

  it("refuses to open registration when a configured 5E fallback omits an actual frozen evidence slot", async () => {
    resolveLiveCompetitiveContextMock.mockResolvedValue({
      platform: "perfect_world", currentSeasonKey: "s21", previousSeasonKey: "s20", priorSeasonKey: "s19", rankOrder: ["bronze", "silver"],
    });
    const season = majorSeason("perfect_world");
    season.teamRegistrationConfig.competitiveProfile!.fallbackConversion = {
      sourcePlatform: "fivee", version: "major-2026-v1", seasonKeyMap: { s20: "5e-s20", s21: "5e-s21" }, mapping: { belowSRankMap: { bronze: "bronze" }, starSegments: [{minStar:0,maxStar:null,targetRank:"A",targetStarFloor:null,slopeNum:0,slopeDen:1}], relativeSeasonAlignment: true },
    };
    await expect(freezeCompetitiveContext(tx, season)).rejects.toThrow("5E fallback 映射必须覆盖本届冻结的全部赛季证据槽");
  });

  it("refuses a complete fallback map when its 5E source catalog identities no longer exist", async () => {
    resolveLiveCompetitiveContextMock.mockResolvedValue({
      platform: "perfect_world", currentSeasonKey: "s21", previousSeasonKey: "s20", priorSeasonKey: "s19", rankOrder: ["bronze", "silver"],
    });
    fallbackCatalogReferencesExistMock.mockResolvedValue(false);
    const season = majorSeason("perfect_world");
    season.teamRegistrationConfig.competitiveProfile!.fallbackConversion = {
      sourcePlatform: "fivee", version: "major-2026-v1", seasonKeyMap: { s19: "5e-s19", s20: "5e-s20", s21: "5e-s21" }, mapping: { belowSRankMap: { bronze: "bronze" }, starSegments: [{minStar:0,maxStar:null,targetRank:"A",targetStarFloor:null,slopeNum:0,slopeDen:1}], relativeSeasonAlignment: true },
    };
    await expect(freezeCompetitiveContext(tx, season)).rejects.toThrow("5E fallback 映射引用的赛季或段位已不在竞技目录中");
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
});
