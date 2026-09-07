import { describe, expect, it } from "vitest";
import { normalizeRegistrationConfig } from "@/lib/seasons/compatibility";

describe("normalizeRegistrationConfig()", () => {
  it("preserves null rank thresholds as no-threshold settings", () => {
    const config = normalizeRegistrationConfig({
      rankThreshold: {
        currentMin: null,
        peakMin: null,
      },
    });

    expect(config.rankThreshold).toEqual({
      currentMin: null,
      peakMin: null,
    });
  });

  it("fills only missing rank threshold fields from Rivals defaults", () => {
    const config = normalizeRegistrationConfig({
      rankThreshold: {
        currentMin: null,
      },
    });

    expect(config.rankThreshold).toEqual({
      currentMin: null,
      peakMin: "A+",
    });
  });
});
