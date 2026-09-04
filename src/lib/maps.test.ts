import { describe, expect, it } from "vitest";
import {
  CURRENT_CS2_ACTIVE_DUTY_MAP_POOL,
  type MapPreferenceDraft,
} from "@/types/season";
import { projectMapPreferences, toMapPreferenceFacts } from "./maps";

describe("map preference projections", () => {
  it("projects only the requested context and preserves missing maps as unfilled", () => {
    expect(projectMapPreferences(
      [{ map: "de_overpass", level: "strong" }],
      CURRENT_CS2_ACTIVE_DUTY_MAP_POOL,
    )).toEqual(CURRENT_CS2_ACTIVE_DUTY_MAP_POOL.map((map) => ({ map, level: null })));
  });

  it("keeps explicit none distinct from a missing fact", () => {
    expect(projectMapPreferences(
      [{ map: "de_mirage", level: "none" }],
      ["de_cache", "de_mirage"],
    )).toEqual([
      { map: "de_cache", level: null },
      { map: "de_mirage", level: "none" },
    ]);
  });

  it("projects custom event maps without adding them to long-term facts", () => {
    expect(projectMapPreferences(
      [{ map: "de_cache", level: "strong" }],
      ["de_custom_nju", "de_cache"],
    )).toEqual([
      { map: "de_custom_nju", level: null },
      { map: "de_cache", level: "strong" },
    ]);
  });

  it("removes unfilled draft entries before persistence", () => {
    const draft: MapPreferenceDraft[] = [
      { map: "de_mirage", level: "strong" },
      { map: "de_cache", level: null },
      { map: "de_overpass", level: "none" },
    ];
    expect(toMapPreferenceFacts(draft)).toEqual([
      { map: "de_mirage", level: "strong" },
      { map: "de_overpass", level: "none" },
    ]);
  });
});
