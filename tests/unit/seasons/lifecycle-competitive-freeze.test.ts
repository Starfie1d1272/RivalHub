import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveLiveCompetitiveContextMock } = vi.hoisted(() => ({
  resolveLiveCompetitiveContextMock: vi.fn(),
}));

vi.mock("@/lib/competitive/catalog", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/competitive/catalog")>();
  return { ...original, resolveLiveCompetitiveContext: resolveLiveCompetitiveContextMock };
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
});

describe("freezeCompetitiveContext", () => {
  it("freezes current, previous and the platform ladder rank keys", async () => {
    resolveLiveCompetitiveContextMock.mockResolvedValue({
      platform: "perfect_world",
      currentSeasonKey: "s21",
      previousSeasonKey: "s20",
      rankOrder: ["bronze", "silver", "gold"],
    });
    const config = await freezeCompetitiveContext(tx, majorSeason("perfect_world"));
    expect(config.competitiveProfile).toEqual({
      platform: "perfect_world",
      currentSeasonKey: "s21",
      previousSeasonKey: "s20",
      rankOrder: ["bronze", "silver", "gold"],
    });
  });

  it("defaults the platform to perfect_world when the draft carries none", async () => {
    resolveLiveCompetitiveContextMock.mockResolvedValue({
      platform: "perfect_world",
      currentSeasonKey: "s21",
      previousSeasonKey: "s20",
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
