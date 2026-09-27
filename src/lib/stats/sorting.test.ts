import { describe, expect, it } from "vitest";
import { compareStatsValues, sortStatsRows } from "./sorting";

describe("stats sorting", () => {
  it("keeps missing values last in either direction", () => {
    expect(compareStatsValues(null, 2, "desc")).toBeGreaterThan(0);
    expect(compareStatsValues(null, 2, "asc")).toBeGreaterThan(0);
  });

  it("applies deterministic tie breakers", () => {
    const result = sortStatsRows([
      { name: "Beta", value: 2 },
      { name: "Alpha", value: 2 },
      { name: "Gamma", value: null },
    ], { getValue: (row) => row.value, direction: "desc" }, [{ getValue: (row) => row.name, direction: "asc" }]);
    expect(result.map((row) => row.name)).toEqual(["Alpha", "Beta", "Gamma"]);
  });
});
