import { describe, it, expect } from "vitest";
import { buildRegistrationSchema } from "@/lib/validators/registration";
import type { PlayerType, RegistrationConfig } from "@/types/season";

// CS2 positions for Rivals
const positions = ["igl", "awper", "opener", "closer", "anchor"];

function buildSchemaConfig(overrides: Record<string, unknown> = {}) {
  const config = {
    allowedPlayerTypes: ["enrolled", "graduated"] as PlayerType[],
    rankThreshold: {
      currentMin: overrides.currentMin ?? undefined,
      peakMin: overrides.peakMin ?? undefined,
    },
    maxPerPosition: 15,
    screenshotCount: 1,
    maxTotal: 56,
    ...overrides,
  };
  return config as Partial<RegistrationConfig>;
}

function buildSchema(overrides?: Record<string, unknown>) {
  return buildRegistrationSchema(buildSchemaConfig(overrides), positions);
}

function validData(overrides?: Record<string, unknown>) {
  return {
    seasonId: "00000000-0000-0000-0000-000000000001",
    email: "test@example.com",
    studentId: "20250001",
    playerType: "enrolled",
    qq: "123456789",
    perfectName: "测试选手",
    steamName: "TestPlayer",
    steam64: "76561198000000000",
    steamProfileUrl: "https://steamcommunity.com/id/testplayer",
    primaryPosition: "igl",
    secondaryPosition: "awper",
    peakRank: "A+",
    peakRankSeason: "S1 2025",
    peakRating: 1.5,
    currentSeasonPeakRank: "A",
    currentRating: 1.2,
    screenshotUrls: [],
    mapPreferences: [
      { map: "de_mirage", level: "strong" },
      { map: "de_inferno", level: "proficient" },
      { map: "de_nuke", level: "playable" },
      { map: "de_ancient", level: "basic" },
      { map: "de_dust2", level: "basic" },
      { map: "de_anubis", level: "basic" },
      { map: "de_cache", level: "none" },
    ],
    gameplayStyle: "激进突破",
    antiCheatPledge: true,
    ...overrides,
  };
}

describe("buildRegistrationSchema", () => {
  it("accepts valid registration data", () => {
    const schema = buildSchema();
    const result = schema.safeParse(validData());
    expect(result.success).toBe(true);
  });

  it("rejects when primary === secondary position", () => {
    const schema = buildSchema();
    const result = schema.safeParse(
      validData({ primaryPosition: "igl", secondaryPosition: "igl" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].path).toContain("secondaryPosition");
    }
  });

  it("rejects rank below both thresholds", () => {
    // Both thresholds require A or above. "B" does not meet either.
    const schema = buildSchema({
      rankThreshold: { currentMin: "A", peakMin: "A" },
    });
    const result = schema.safeParse(
      validData({ currentSeasonPeakRank: "B", peakRank: "B" }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts rank meeting peak threshold even when current is below", () => {
    // current A-required but not met, peak A+-required and met
    const schema = buildSchema({
      rankThreshold: { currentMin: "A", peakMin: "A+" },
    });
    const result = schema.safeParse(
      validData({
        currentSeasonPeakRank: "B",
        peakRank: "A+",
      }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects without antiCheatPledge", () => {
    const schema = buildSchema();
    const result = schema.safeParse(
      validData({ antiCheatPledge: false }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects invalid email", () => {
    const schema = buildSchema();
    const result = schema.safeParse(validData({ email: "notanemail" }));
    expect(result.success).toBe(false);
  });

  it("rejects invalid steam64 (not 17 digits)", () => {
    const schema = buildSchema();
    const result = schema.safeParse(validData({ steam64: "123" }));
    expect(result.success).toBe(false);
  });

  it("accepts empty screenshot links", () => {
    const schema = buildSchema();
    const result = schema.safeParse(validData({ screenshotUrls: [] }));
    expect(result.success).toBe(true);
  });

  it("rejects map preferences outside the season map pool", () => {
    const schema = buildSchema();
    const result = schema.safeParse(
      validData({
        mapPreferences: [
          { map: "de_cache", level: "strong" },
          { map: "de_inferno", level: "proficient" },
          { map: "de_nuke", level: "playable" },
          { map: "de_ancient", level: "basic" },
          { map: "de_dust2", level: "basic" },
          { map: "de_anubis", level: "basic" },
          { map: "de_overpass", level: "none" },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("uses the event-owned map pool, including custom maps", () => {
    const schema = buildRegistrationSchema({
      ...buildSchemaConfig(),
      mapPool: ["de_custom_nju", "de_cache", "de_mirage"],
    }, positions);
    const result = schema.safeParse(validData({
      mapPreferences: [
        { map: "de_custom_nju", level: "strong" },
        { map: "de_cache", level: "proficient" },
        { map: "de_mirage", level: "playable" },
      ],
    }));
    expect(result.success).toBe(true);
  });

});
