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
    expect(matrix.filter(job => job.task === "provider")).toHaveLength(1);
    expect(matrix.filter(job => job.task.startsWith("production-")).map(job => job.project).sort()).toEqual(playwrightConfig.projects.map(project => project.name).sort());
    expect(systemMatrixFor({ runSystem: true, full: false, e2eSpecs: [ordinary] }, false).some(job => job.task === "browser-series")).toBe(false);
    expect(systemMatrixFor({ runSystem: true, full: false, e2eSpecs: [session] }, false).filter(job => job.task.startsWith("browser-"))).toEqual([
      { task: "browser-session", live: false, specs: [session] },
    ]);
  });

  it("isolates measured expensive routes and keeps desktop OCR and isolates database evidence", () => {
    const heavy = ["admin-match-readiness", "admin-content-read-boundaries", "major-qualification", "major-entry", "platform-stats", "predictions", "test-matches"].map(name => `tests/e2e/flows/${name}.spec.ts`);
    const ocr = "tests/e2e/flows/ocr-receipt-recovery.spec.ts";
    const receipt = "tests/e2e/flows/bet-receipt.spec.ts";
    const evidence = "tests/e2e/flows/admin-immediate-boundaries.spec.ts";
    const jobs = systemMatrixFor({ runSystem: true, full: false, e2eSpecs: [...heavy, ocr, ocr, receipt, evidence, evidence] }, false).filter(job => job.task.startsWith("browser-"));
    for (const spec of heavy) expect(jobs.filter(job => job.specs.includes(spec))).toEqual([expect.objectContaining({ specs: [spec] })]);
    expect(jobs.filter(job => job.specs.includes(ocr)).map(job => job.project)).toEqual(["chromium"]);
    expect(jobs.filter(job => job.specs.includes(receipt))).toHaveLength(1);
    expect(jobs.filter(job => job.specs.includes(evidence)).map(job => job.project)).toEqual(["chromium"]);
    expect(jobs.filter(job => job.project).every(job => job.specs.length === 1 && [ocr, evidence].includes(job.specs[0]))).toBe(true);
  });

  it("partitions all six BET views exactly once without losing ordinary BET or receipts", () => {
    const stages = "tests/e2e/flows/bet-read-stages.spec.ts";
    const ordinary = ["tests/e2e/flows/bet.spec.ts", "tests/e2e/flows/bet-receipt.spec.ts"];
    const views = ["open", "mine", "settled", "event", "leaderboard", "records"];
    for (const full of [false, true]) {
      const jobs = systemMatrixFor({ runSystem: true, full, e2eSpecs: [stages, ...ordinary, stages] }, false);
      const lanes = jobs.filter(job => job.specs.includes(stages));
      expect(lanes).toHaveLength(6);
      for (const view of views) expect(lanes.filter(job => new RegExp(job.grep).test(`BET ${view} retains privacy`))).toHaveLength(1);
      for (const lane of lanes) {
        expect(lane.specs).toEqual([stages]);
        expect(views.filter(view => new RegExp(lane.grep).test(`BET ${view} retains privacy`))).toHaveLength(1);
      }
      for (const spec of ordinary) {
        const selected = jobs.filter(job => job.specs.includes(spec));
        expect(selected).toHaveLength(1);
        expect(selected[0].grep).toBeUndefined();
      }
      expect(jobs.every(job => job.specs.length > 0 || job.task === "provider" || job.task.startsWith("production-"))).toBe(true);
    }
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
      const names = spec => spec.endsWith("/bet-read-stages.spec.ts") ? ["open", "mine", "settled", "event", "leaderboard", "records"].map(view => `BET ${view} retains privacy`) : ["spec"];
      const actual = jobs.flatMap(job => job.specs.flatMap(spec => names(spec).filter(name => !job.grep || new RegExp(job.grep).test(name)).flatMap(name => playwrightConfig.projects.filter(project => (!job.project || job.project === project.name) && runnable(spec, project)).map(project => `${spec}:${project.name}:${name}`))));
      const expected = selected.flatMap(spec => names(spec).flatMap(name => playwrightConfig.projects.filter(project => runnable(spec, project)).map(project => `${spec}:${project.name}:${name}`)));
      expect(actual.sort()).toEqual(expected.sort());
      expect(new Set(actual).size).toBe(actual.length);
      expect(jobs.every(job => job.specs.length > 0 && job.specs.length <= 2)).toBe(true);
    }
    expect(systemMatrixFor({ runSystem: false, full: true, e2eSpecs: [] }, false)).toEqual([]);
  });

});
