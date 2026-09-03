import { describe, expect, it } from "vitest";
import { mapPreferencesSchema } from "./map-preferences";
import { DEFAULT_CS2_MAP_POOL } from "@/types/season";

function prefs(overrides: Record<string, string> = {}) {
  const base: Record<string, string> = {
    de_mirage: "strong",
    de_inferno: "proficient",
    de_nuke: "playable",
    de_ancient: "basic",
    de_dust2: "basic",
    de_anubis: "basic",
    de_overpass: "none",
  };
  return DEFAULT_CS2_MAP_POOL.map((map) => ({ map, level: overrides[map] ?? base[map] }));
}

describe("mapPreferencesSchema", () => {
  const schema = mapPreferencesSchema(DEFAULT_CS2_MAP_POOL);

  it("接受合法地图熟练度", () => {
    expect(schema.safeParse(prefs()).success).toBe(true);
  });

  it("拒绝能打地图少于 3 张", () => {
    expect(schema.safeParse(prefs({ de_mirage: "basic", de_inferno: "basic", de_nuke: "basic" })).success).toBe(false);
  });

  it("拒绝强图超过 3 张", () => {
    expect(schema.safeParse(prefs({ de_inferno: "strong", de_nuke: "strong", de_ancient: "strong", de_dust2: "strong" })).success).toBe(false);
  });

  it("拒绝图池外的地图", () => {
    expect(schema.safeParse(prefs().map((p) => (p.map === "de_mirage" ? { ...p, map: "de_train" } : p))).success).toBe(false);
  });

  it("拒绝重复地图", () => {
    expect(schema.safeParse(prefs().map((p) => (p.map === "de_inferno" ? { ...p, map: "de_mirage" } : p))).success).toBe(false);
  });
});
