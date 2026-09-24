import { describe, expect, it } from "vitest";
import { buildMetricBenchmark, projectMetricBenchmarkScore } from "./benchmark";

describe("metric benchmark projection", () => {
  it("reuses the dynamic ranking floor and excludes limited samples from the benchmark", () => {
    const benchmark = buildMetricBenchmark([
      { value: 10, sample: 5 },
      { value: 20, sample: 20 },
      { value: 30, sample: 80 },
      { value: 40, sample: 100 },
    ]);

    expect(benchmark).not.toBeNull();
    expect(benchmark?.floor).toEqual({
      floor: 20,
      reference: 80,
      quantile: 0.75,
      share: 0.25,
    });
    expect(benchmark?.qualifiedValues).toEqual([20, 30, 40]);
  });

  it("scores limited samples against the qualified benchmark without promoting them", () => {
    const benchmark = buildMetricBenchmark([
      { value: 20, sample: 20 },
      { value: 30, sample: 80 },
      { value: 40, sample: 100 },
    ])!;

    expect(projectMetricBenchmarkScore({ value: 35, sample: 5 }, benchmark)).toEqual({
      percentile: 2 / 3,
      score: 67,
      status: "limited",
      floor: 20,
      qualifiedCount: 3,
    });

    expect(projectMetricBenchmarkScore({ value: 35, sample: 20 }, benchmark)).toEqual({
      percentile: 2 / 3,
      score: 67,
      status: "qualified",
      floor: 20,
      qualifiedCount: 3,
    });
  });

  it("uses midrank percentile semantics for tied qualified values", () => {
    const benchmark = buildMetricBenchmark([
      { value: 20, sample: 100 },
      { value: 30, sample: 100 },
      { value: 30, sample: 100 },
      { value: 40, sample: 100 },
    ])!;

    expect(projectMetricBenchmarkScore({ value: 30, sample: 100 }, benchmark)).toMatchObject({
      percentile: 0.5,
      score: 50,
      status: "qualified",
    });
  });

  it("projects values outside the qualified range onto the same 0-100 scale", () => {
    const benchmark = buildMetricBenchmark([
      { value: 20, sample: 100 },
      { value: 30, sample: 100 },
      { value: 40, sample: 100 },
    ])!;

    expect(projectMetricBenchmarkScore({ value: 10, sample: 1 }, benchmark)?.score).toBe(0);
    expect(projectMetricBenchmarkScore({ value: 50, sample: 1 }, benchmark)?.score).toBe(100);
  });

  it("does not manufacture a score when the metric itself has no value", () => {
    const benchmark = buildMetricBenchmark([
      { value: 20, sample: 100 },
      { value: 30, sample: 100 },
    ])!;

    expect(projectMetricBenchmarkScore({ value: null, sample: 100 }, benchmark)).toBeNull();
  });
});
