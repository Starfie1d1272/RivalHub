import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseMajorFinalPlacementGroups } from "@/lib/major/placement";

const entryIds = Array.from({ length: 32 }, () => randomUUID());
const validPlacements = [{ from: 1, to: 32, entryIds }];

describe("parseMajorFinalPlacementGroups", () => {
  it("accepts a contiguous 32-entry official result", () => {
    expect(parseMajorFinalPlacementGroups(validPlacements, entryIds[0]!)).toEqual(validPlacements);
  });

  it("rejects duplicate entrants even when range cardinality matches", () => {
    expect(() => parseMajorFinalPlacementGroups([{
      from: 1,
      to: 32,
      entryIds: [...entryIds.slice(0, 31), entryIds[0]!],
    }], entryIds[0]!)).toThrow("duplicate entries");
  });

  it("rejects a champion pointer that differs from first place", () => {
    expect(() => parseMajorFinalPlacementGroups(validPlacements, entryIds[1]!))
      .toThrow("champion must equal first placement entry");
  });
});
