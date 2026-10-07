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

  it("adding an integration test cannot narrow a source change's PostgreSQL evidence", () => {
    const before = plan("src/actions/register.ts");
    const after = plan("src/actions/register.ts", "tests/integration/db/bet.test.ts");
    expect(before.runPostgres).toBe(true);
    expect(after.integrationSpecs).toEqual(before.integrationSpecs);
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

  it("keeps a presentation-only change out of service lanes", () => {
    expect(plan("src/components/layout/Footer.tsx").requiredJobs).toEqual(["static"]);
  });
});
