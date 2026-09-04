import { describe, expect, it } from "vitest";
import {
  eventMapPreferencesSchema,
  longTermMapPreferencesSchema,
} from "./map-preferences";
import {
  CURRENT_CS2_ACTIVE_DUTY_MAP_POOL,
  SUPPORTED_CS2_MAP_KEYS,
} from "@/types/season";

function eventPrefs(overrides: Record<string, string> = {}) {
  const base: Record<string, string> = {
    de_mirage: "strong",
    de_inferno: "proficient",
    de_nuke: "playable",
    de_ancient: "basic",
    de_dust2: "basic",
    de_anubis: "basic",
    de_cache: "none",
  };
  return CURRENT_CS2_ACTIVE_DUTY_MAP_POOL.map((map) => ({ map, level: overrides[map] ?? base[map] }));
}

describe("eventMapPreferencesSchema", () => {
  const schema = eventMapPreferencesSchema(CURRENT_CS2_ACTIVE_DUTY_MAP_POOL);

  it("接受合法地图熟练度", () => {
    expect(schema.safeParse(eventPrefs()).success).toBe(true);
  });

  it("拒绝能打地图少于 3 张", () => {
    expect(schema.safeParse(eventPrefs({ de_mirage: "basic", de_inferno: "basic", de_nuke: "basic" })).success).toBe(false);
  });

  it("拒绝强图超过 3 张", () => {
    expect(schema.safeParse(eventPrefs({ de_inferno: "strong", de_nuke: "strong", de_ancient: "strong", de_dust2: "strong" })).success).toBe(false);
  });

  it("拒绝图池外的地图", () => {
    expect(schema.safeParse(eventPrefs().map((p) => (p.map === "de_mirage" ? { ...p, map: "de_train" } : p))).success).toBe(false);
  });

  it("拒绝重复地图", () => {
    expect(schema.safeParse(eventPrefs().map((p) => (p.map === "de_inferno" ? { ...p, map: "de_mirage" } : p))).success).toBe(false);
  });

  it("拒绝报名时未填写地图", () => {
    expect(schema.safeParse(eventPrefs({ de_cache: "" }).map((preference) => (
      preference.map === "de_cache" ? { ...preference, level: null } : preference
    ))).success).toBe(false);
  });
});

describe("longTermMapPreferencesSchema", () => {
  const schema = longTermMapPreferencesSchema();

  it("接受稀疏且跨赛事的稳定目录事实", () => {
    expect(schema.safeParse([
      { map: "de_overpass", level: "strong" },
      { map: "de_cache", level: "none" },
    ]).success).toBe(true);
  });

  it("不附加报名用的能打或强图配额", () => {
    expect(schema.safeParse([
      { map: SUPPORTED_CS2_MAP_KEYS[0], level: "playable" },
      { map: SUPPORTED_CS2_MAP_KEYS[1], level: "basic" },
      { map: SUPPORTED_CS2_MAP_KEYS[2], level: "none" },
      { map: SUPPORTED_CS2_MAP_KEYS[3], level: "strong" },
    ]).success).toBe(true);
  });

  it("接受空资料并拒绝重复或非目录地图", () => {
    expect(schema.safeParse([]).success).toBe(true);
    expect(schema.safeParse([
      { map: "de_mirage", level: "basic" },
      { map: "de_mirage", level: "strong" },
    ]).success).toBe(false);
    expect(schema.safeParse([{ map: "de_custom_map", level: "strong" }]).success).toBe(false);
  });
});
