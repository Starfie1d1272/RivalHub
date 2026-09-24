import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseMajorFinalPlacementGroups } from "@/lib/major/placement";

const entryIds = Array.from({ length: 32 }, () => randomUUID());
const validPlacements = [{ from: 1, to: 32, entryIds }];
const entryIds24 = Array.from({ length: 24 }, () => randomUUID());
const validPlacements24 = [{ from: 1, to: 24, entryIds: entryIds24 }];

describe("parseMajorFinalPlacementGroups", () => {
  it("accepts a contiguous 32-entry official result", () => {
    expect(parseMajorFinalPlacementGroups(validPlacements, entryIds[0]!, 32)).toEqual(validPlacements);
  });

  it("accepts a contiguous 24-entry official result using the explicit frozen capacity", () => {
    expect(parseMajorFinalPlacementGroups(validPlacements24, entryIds24[0]!, 24)).toEqual(validPlacements24);
    expect(() => parseMajorFinalPlacementGroups(validPlacements24, entryIds24[0]!, 32)).toThrow("cover 32 entries");
  });

  it("rejects duplicate entrants even when range cardinality matches", () => {
    expect(() => parseMajorFinalPlacementGroups([{
      from: 1,
      to: 32,
      entryIds: [...entryIds.slice(0, 31), entryIds[0]!],
    }], entryIds[0]!, 32)).toThrow("duplicate entries");
  });

  it("rejects a champion pointer that differs from first place", () => {
    expect(() => parseMajorFinalPlacementGroups(validPlacements, entryIds[1]!, 32))
      .toThrow("champion must equal first placement entry");
  });
});
