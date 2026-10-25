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

  it("isolates correction, LIVE and session flows without dropping or duplicating selected evidence", () => {
    const series = "tests/e2e/flows/series-score-correction.spec.ts";
    const live = "tests/e2e/flows/public-match-live.spec.ts";
    const ordinary = "tests/e2e/flows/free-predictions.spec.ts";
    const session = "tests/e2e/flows/session-revocation.spec.ts";
    const selected = [ordinary, series, live, series, session, session];
    const matrix = systemMatrixFor({ runSystem: true, full: false, e2eSpecs: selected }, true);
    expect(matrix.find(job => job.task === "browser-series")).toEqual({ task: "browser-series", live: false, specs: [series] });
    expect(matrix.find(job => job.task === "browser-live")?.specs).toEqual([live]);
    expect(matrix.find(job => job.task === "browser-session")?.specs).toEqual([session]);
    expect(matrix.filter(job => job.task.startsWith("browser-")).flatMap(job => job.specs).sort()).toEqual([ordinary, series, live, session].sort());
    expect(matrix.filter(job => ["provider", "production"].includes(job.task))).toHaveLength(2);
    expect(systemMatrixFor({ runSystem: true, full: false, e2eSpecs: [ordinary] }, false).some(job => job.task === "browser-series")).toBe(false);
    expect(systemMatrixFor({ runSystem: true, full: false, e2eSpecs: [session] }, false).filter(job => job.task.startsWith("browser-"))).toEqual([
      { task: "browser-session", live: false, specs: [session] },
    ]);
  });

  it("isolates measured expensive routes and partitions both OCR projects", () => {
    const heavy = ["admin-match-readiness", "admin-content-read-boundaries", "major-qualification", "major-entry", "test-matches"].map(name => `tests/e2e/flows/${name}.spec.ts`);
    const ocr = "tests/e2e/flows/ocr-receipt-recovery.spec.ts";
    const receipt = "tests/e2e/flows/bet-receipt.spec.ts";
    const jobs = systemMatrixFor({ runSystem: true, full: false, e2eSpecs: [...heavy, ocr, ocr, receipt] }, false).filter(job => job.task.startsWith("browser-"));
    for (const spec of heavy) expect(jobs.filter(job => job.specs.includes(spec))).toEqual([expect.objectContaining({ specs: [spec] })]);
    expect(jobs.filter(job => job.specs.includes(ocr)).map(job => job.project).sort()).toEqual(["chromium", "mobile-chrome"]);
    expect(jobs.filter(job => job.specs.includes(receipt))).toHaveLength(1);
    expect(jobs.filter(job => job.project).every(job => job.specs.length === 1 && job.specs[0] === ocr)).toBe(true);
  });

  it("covers every selected runnable (spec, project) exactly once in full and affected plans", () => {
    const files = readdirSync("tests/e2e/flows").filter(name => name.endsWith(".spec.ts")).map(name => `tests/e2e/flows/${name}`).sort();
    // The current project exclusions are literal spec basenames or whole
    // excluded directories. Fail on new matcher shapes instead of guessing.
    const runnable = (spec, project) => !(project.testIgnore ?? []).some(pattern => {
      expect(typeof pattern).toBe("string");
      expect(pattern).toMatch(/^\*\*\/(?:[^/*]+\.spec\.ts|(?:visual|acceptance|production)\/\*\*)$/);
      return pattern.endsWith(`/${spec.split("/").at(-1)}`);
    });
    for (const full of [false, true]) {
      const selected = full ? files : files.filter((_, index) => index % 2 === 0);
      const jobs = systemMatrixFor({ runSystem: true, full, e2eSpecs: [...selected, ...selected] }, true).filter(job => job.task.startsWith("browser-"));
      const actual = jobs.flatMap(job => job.specs.flatMap(spec => playwrightConfig.projects.filter(project => (!job.project || job.project === project.name) && runnable(spec, project)).map(project => `${spec}:${project.name}`)));
      const expected = selected.flatMap(spec => playwrightConfig.projects.filter(project => runnable(spec, project)).map(project => `${spec}:${project.name}`));
      expect(actual.sort()).toEqual(expected.sort());
      expect(new Set(actual).size).toBe(actual.length);
      expect(jobs.every(job => job.specs.length > 0 && job.specs.length <= 2)).toBe(true);
    }
    expect(systemMatrixFor({ runSystem: false, full: true, e2eSpecs: [] }, false)).toEqual([]);
  });

});
