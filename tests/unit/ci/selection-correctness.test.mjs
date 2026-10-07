import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { classifyChangedFiles } from "../../../scripts/ci/plan.mjs";

const plan = (...paths) => classifyChangedFiles(paths.map((path) => ({ status: "M", paths: [path] })));

describe("affected evidence correctness", () => {
  it("looks for source consumers in every test project", () => {
    const selection = plan("src/lib/auth/session.ts");
    for (const project of ["unit-domain-node", "unit-server-node", "unit-react-jsdom"]) {
      expect(selection.staticMatrix).toContainEqual(expect.objectContaining({
        project, relatedSources: ["src/lib/auth/session.ts"],
      }));
    }
  });

  it.each(["tests/unit/app/admin-layout.test.tsx", "src/components/matches/MatchLiveProvider.test.tsx"])("executes %s in its actual project", (path) => {
    expect(plan(path).staticMatrix).toContainEqual(expect.objectContaining({
      project: "unit-react-jsdom", explicitTests: [path],
    }));
    const tests = JSON.parse(execFileSync(process.execPath, [
      "node_modules/vitest/vitest.mjs", "list", "--project=unit-react-jsdom", path, "--json",
    ], { encoding: "utf8" }));
    expect(tests.length).toBeGreaterThan(0);
  });

  it("rejects an explicit test routed to a project that cannot discover it", () => {
    const result = spawnSync(process.execPath, [
      "node_modules/vitest/vitest.mjs", "run", "--project=unit-server-node", "tests/unit/app/admin-layout.test.tsx",
    ], { encoding: "utf8" });
    expect(result.status).not.toBe(0);
  });

  it("rejects a partially undiscovered explicit batch even when another test is valid", () => {
    const result = spawnSync(process.execPath, ["scripts/ci/run-static-task.mjs"], {
      encoding: "utf8",
      env: { ...process.env, STATIC_TASK: "unit-explicit-unit-domain-node", STATIC_PROJECT: "unit-domain-node", STATIC_EXPLICIT_TESTS: JSON.stringify(["tests/unit/ci/plan.test.mjs", "tests/unit/app/admin-layout.test.tsx"]) },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("explicit tests were not discovered");
    expect(result.stderr).toContain("admin-layout.test.tsx");
  });

  it("adding an integration test cannot narrow a source change's PostgreSQL evidence", () => {
    const before = plan("src/actions/register.ts");
    const after = plan("src/actions/register.ts", "tests/integration/db/bet.test.ts");
    expect(before.runPostgres).toBe(true);
    if (before.integrationSpecs.length === 0) expect(after.integrationSpecs).toEqual([]);
    else for (const spec of before.integrationSpecs) expect(after.integrationSpecs).toContain(spec);
    expect(plan("tests/integration/db/bet.test.ts").integrationSpecs).toEqual(["tests/integration/db/bet.test.ts"]);
  });

  it("adding an E2E cannot narrow shared harness evidence", () => {
    const before = plan("tests/e2e/fixtures.ts");
    const after = plan("tests/e2e/fixtures.ts", "tests/e2e/flows/bet.spec.ts");
    expect(before.e2eSpecs.length).toBeGreaterThan(1);
    expect(after.e2eSpecs).toEqual(before.e2eSpecs);
  });

  it.each(["src/components/matches/MatchLiveProvider.tsx", "src/lib/mizar/live-viewer.ts"])("runs the real browser consumer for %s", (path) => {
    expect(plan(path).runSystem).toBe(true);
    expect(plan(path).e2eSpecs).toContain("tests/e2e/flows/public-match-live.spec.ts");
  });

  it("selects PostgreSQL consumers transitively and unions mixed domains", () => {
    const paths = ["src/lib/mizar/live.ts", "src/lib/education/commands.ts"];
    const union = plan(...paths, "tests/integration/db/bet.test.ts");
    expect(union.integrationSpecs).toContain("tests/integration/db/bet.test.ts");
    for (const path of paths) {
      const selected = plan(path).integrationSpecs;
      expect(selected.length).toBeGreaterThan(0);
      for (const spec of selected) expect(union.integrationSpecs).toContain(spec);
    }
    expect(plan("src/db/schema/mizar.ts", "tests/integration/db/bet.test.ts").integrationSpecs).toEqual([]);
  });

  it("keeps a presentation-only change out of service lanes", () => {
    expect(plan("src/components/layout/Footer.tsx").requiredJobs).toEqual(["static"]);
  });
});
