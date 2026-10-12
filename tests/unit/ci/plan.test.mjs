import { describe, expect, it } from "vitest";
import { classifyChangedFiles } from "../../../scripts/ci/plan.mjs";

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

});
