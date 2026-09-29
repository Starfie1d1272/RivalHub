import { describe, expect, it } from "vitest";
import { applyOcrScoreboardEnrichment } from "./scoreboard-ownership";

describe("operator scoreboard enrichment ownership", () => {
  it("keeps existing operator values when a later OCR row omits a field after DAK promotion", () => {
    expect(applyOcrScoreboardEnrichment(
      { dakImportId: "dak-1", ratingPro: 1.2, rws: 7.5, we: 8 },
      { ratingPro: null, rws: 0, we: null },
    )).toEqual({ ratingPro: 1.2, rws: 0, we: 8 });
  });

  it("keeps missing OCR fields null before DAK while allowing a supplied correction", () => {
    expect(applyOcrScoreboardEnrichment(
      { dakImportId: null, ratingPro: null, rws: null, we: null },
      { ratingPro: 1.3, rws: null, we: 0 },
    )).toEqual({ ratingPro: 1.3, rws: null, we: 0 });
  });
});
