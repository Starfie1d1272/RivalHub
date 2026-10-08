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
    ], { encoding: "utf8", env: { ...process.env, RIVALHUB_TIMING: "0" } });
    expect(result.status).not.toBe(0);
  });

  it("rejects a partially undiscovered explicit batch even when another test is valid", () => {
    const result = spawnSync(process.execPath, ["scripts/ci/run-static-task.mjs"], {
      encoding: "utf8",
      env: { ...process.env, RIVALHUB_TIMING: "0", STATIC_TASK: "unit-explicit-unit-domain-node", STATIC_PROJECT: "unit-domain-node", STATIC_EXPLICIT_TESTS: JSON.stringify(["tests/unit/ci/plan.test.mjs", "tests/unit/app/admin-layout.test.tsx"]) },
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

  it.each([
    ["src/components/auth/LoginForm.tsx", ["tests/e2e/flows/major-entry.spec.ts", "tests/e2e/flows/session-revocation.spec.ts"]],
    ["src/components/auth/TurnstileWidget.tsx", ["tests/e2e/flows/major-entry.spec.ts", "tests/e2e/flows/session-revocation.spec.ts"]],
    ["src/components/predictions/PredictionBoard.tsx", ["tests/e2e/flows/predictions.spec.ts"]],
    ["src/components/predictions/PickEditor.tsx", ["tests/e2e/flows/predictions.spec.ts"]],
    ["src/components/admin/MajorCompetitionFlow.tsx", ["tests/e2e/flows/major-qualification.spec.ts"]],
  ])("selects the user flow owned by %s even through a Server Action", (path, specs) => {
    const selection = plan(path);
    expect(selection.full).toBe(false);
    expect(selection.runSystem).toBe(true);
    expect(selection.e2eSpecs).toEqual(specs);
    const mixed = plan(path, "tests/e2e/flows/event-logo.spec.ts");
    expect(mixed.e2eSpecs).toEqual([...specs, "tests/e2e/flows/event-logo.spec.ts"].sort());
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

  it("discovers correctness in required PostgreSQL and capacity only in the experiment entry", () => {
    const files = config => JSON.parse(execFileSync(process.execPath, ["node_modules/vitest/vitest.mjs", "list", "--config", config, "--filesOnly", "--json"], { encoding: "utf8" })).map(item => item.file);
    const core = files("vitest.integration.config.ts");
    expect(core.some(file => file.endsWith("/mizar-live-correctness.test.ts"))).toBe(true);
    expect(core.some(file => file.includes("/experiments/"))).toBe(false);
    const experiments = files("vitest.experiments.config.ts");
    expect(experiments).toHaveLength(1);
    expect(experiments[0]).toContain("/experiments/mizar-live-capacity.test.ts");
  });

  it.each(["src/components/layout/Footer.tsx", "src/components/ui/button.tsx", "src/app/globals.css"])("keeps presentation-only %s out of service lanes", (path) => {
    expect(plan(path).requiredJobs).toEqual(["static"]);
  });
});
