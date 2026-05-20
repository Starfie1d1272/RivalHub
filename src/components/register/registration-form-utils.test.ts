import { describe, expect, it } from "vitest";
import { buildPositionLabel, countMapPreferenceLevels, isPositionFull } from "./registration-form-utils";

describe("registration form utils", () => {
  it("builds position labels with capacity status", () => {
    expect(buildPositionLabel("awper", { awper: 1 }, 2)).toBe("AWPer（狙击手）  1/2");
    expect(buildPositionLabel("awper", { awper: 2 }, 2)).toBe("AWPer（狙击手）  已满");
  });

  it("detects full positions", () => {
    expect(isPositionFull("igl", { igl: 2 }, 2)).toBe(true);
    expect(isPositionFull("igl", { igl: 1 }, 2)).toBe(false);
  });

  it("counts playable and strong map preferences", () => {
    expect(
      countMapPreferenceLevels([
        { map: "mirage", level: "strong" },
        { map: "nuke", level: "playable" },
        { map: "inferno", level: "basic" },
        { map: "ancient", level: "none" },
      ]),
    ).toEqual({ playableCount: 2, strongCount: 1 });
  });
});
