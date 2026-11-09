import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import playwrightConfig from "../../../playwright.config.ts";
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

  it("keeps provider, production and ordinary browser evidence independent", () => {
    const planFor = (path, status = "M") => classifyChangedFiles([{ status, paths: [path] }]);
    const browser = planFor("tests/e2e/flows/series-score-correction.spec.ts");
    expect(browser.systemMatrix).toHaveLength(1);
    expect(browser.systemMatrix[0].specs).toEqual(["tests/e2e/flows/series-score-correction.spec.ts"]);
    expect(planFor("supabase/config.toml").systemMatrix.map(job => job.task)).toEqual(["provider"]);
    expect(planFor("playwright.production.config.ts").systemMatrix.map(job => job.task)).toEqual(["production"]);
    expect(planFor(".impeccable/design.json").requiredJobs).toEqual([]);
    expect(planFor("tests/e2e/flows/retired.spec.ts", "D").requiredJobs).toEqual(["static"]);
    expect(planFor("src/lib/retired.ts", "D").full).toBe(true);
  });

  it("covers every selected runnable (spec, project) exactly once in full and affected plans", () => {
    const files = readdirSync("tests/e2e/flows").filter(name => name.endsWith(".spec.ts")).map(name => `tests/e2e/flows/${name}`).sort();
    const runnable = (spec, project) => {
      const suffix = `/${spec.split("/").at(-1)}`;
      return (!project.testMatch || project.testMatch.some(pattern => pattern.endsWith(suffix)))
        && !project.testIgnore?.some(pattern => pattern.endsWith(suffix));
    };
    for (const full of [false, true]) {
      const selected = full ? files : files.filter((_, index) => index % 2 === 0);
      const jobs = systemMatrixFor({ runSystem: true, full, e2eSpecs: [...selected, ...selected] }, true).filter(job => job.task.startsWith("browser-"));
      const actual = jobs.flatMap(job => job.specs.flatMap(spec => playwrightConfig.projects.filter(project => runnable(spec, project)).map(project => `${spec}:${project.name}`)));
      const expected = selected.map(spec => {
        const name = ["bet", "free-predictions", "predictions"].some(flow => spec.endsWith(`/${flow}.spec.ts`)) ? "mobile-chrome" : "chromium";
        return `${spec}:${name}`;
      });
      expect(actual.sort()).toEqual(expected.sort());
      expect(new Set(actual).size).toBe(actual.length);
      expect(jobs.every(job => job.specs.length > 0)).toBe(true);
    }
    expect(systemMatrixFor({ runSystem: false, full: true, e2eSpecs: [] }, false)).toEqual([]);
  });

});
