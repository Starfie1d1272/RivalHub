import { describe, expect, it } from "vitest";
import { classifyChangedFiles, systemMatrixFor } from "../../../scripts/ci/plan.mjs";

describe("changed-surface planner", () => {
  it("fails closed when changed-surface cannot be obtained", () => {
    expect(classifyChangedFiles([]).requiredJobs).toEqual(["static", "postgres", "system"]);
  });

  it("keeps migration on PG without triggering system", () => {
    const migration = classifyChangedFiles([{ status: "A", paths: ["drizzle/migrations/0048_new_feature.sql"] }], { draft: false });
    expect(migration.full).toBe(false);
    expect(migration.requiredJobs).toEqual(["postgres"]);
    expect(migration.runSystem).toBe(false);
  });

  it("isolates correction and LIVE flows without dropping or duplicating selected evidence", () => {
    const series = "tests/e2e/flows/series-score-correction.spec.ts";
    const live = "tests/e2e/flows/public-match-live.spec.ts";
    const ordinary = "tests/e2e/flows/free-predictions.spec.ts";
    const selected = [ordinary, series, live, series];
    const matrix = systemMatrixFor({ runSystem: true, full: false, e2eSpecs: selected }, true);
    expect(matrix.find(job => job.task === "browser-series")).toEqual({ task: "browser-series", live: false, specs: [series] });
    expect(matrix.find(job => job.task === "browser-live")?.specs).toEqual([live]);
    expect(matrix.filter(job => job.task.startsWith("browser-")).flatMap(job => job.specs).sort()).toEqual([ordinary, series, live].sort());
    expect(matrix.filter(job => ["provider", "production"].includes(job.task))).toHaveLength(2);
    expect(systemMatrixFor({ runSystem: true, full: false, e2eSpecs: [ordinary] }, false).some(job => job.task === "browser-series")).toBe(false);
  });

});
