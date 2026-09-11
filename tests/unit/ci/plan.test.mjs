import { describe, expect, it } from "vitest";
import { classifyChangedFiles, parseNameStatus } from "../../../scripts/ci/plan.mjs";

describe("changed-surface planner", () => {
  it.each([
    ["docs-only", ["docs/testing.md", "README.md"], [], false],
    ["Changeset-only", [".changeset/ci-planner.md", ".changeset/config.json"], [], false],
    ["UI + Changeset", ["src/components/layout/Footer.tsx", ".changeset/ui.md"], ["static"], false],
    ["domain + Changeset", ["src/lib/major/opening.ts", ".changeset/domain.md"], ["static"], false],
    ["PostgreSQL source + Changeset", ["src/db/schema/major-stage.ts", ".changeset/schema.md"], ["static", "postgres"], false],
    ["PostgreSQL-only integration", ["tests/integration/db/team-registration.test.ts"], ["static", "postgres"], false],
    ["system-dependent browser test", ["tests/e2e/flows/major-entry.spec.ts"], ["static", "system"], false],
    ["E2E visual test", ["tests/e2e/visual/ui-system.spec.ts"], ["static", "system"], false],
    ["package or lockfile", ["pnpm-lock.yaml"], ["static", "postgres", "system"], true],
    ["CI/toolchain configuration", [".github/workflows/ci.yml"], ["static", "postgres", "system"], true],
    ["migration", ["drizzle/migrations/0032_competitive_fact_states.sql"], ["postgres"], false],
    ["rename", ["src/a.ts", "src/b.ts"], ["static", "postgres", "system"], true, "R100"],
    ["delete", ["src/a.ts"], ["static", "postgres", "system"], true, "D"],
    ["unknown surface with Changeset", [".changeset/metadata.md", "tooling/unknown.bin"], ["static", "postgres", "system"], true],
    ["forceFull", ["docs/testing.md"], ["static", "postgres", "system"], true, "M", { forceFull: true }],
  ])("classifies %s as %j", (label, paths, requiredJobs, full, status = "M", options = {}) => {
    const entries = status.startsWith("R")
      ? [{ status, paths }]
      : paths.map((path) => ({ status, paths: [path] }));
    const result = classifyChangedFiles(entries, options);
    expect(result.requiredJobs).toEqual(requiredJobs);
    expect(result.full).toBe(full);
  });

  it.each([
    ["src/actions/auth.ts", ["static", "postgres", "system"]],
    ["src/lib/auth/supabase.ts", ["static", "system"]],
    ["src/app/[seasonSlug]/register/page.tsx", ["static", "postgres"]],
    ["src/actions/register.ts", ["static", "postgres"]],
    ["src/actions/competition-entries.ts", ["static", "postgres"]],
    ["src/lib/education/storage.ts", ["static", "system"]],
    ["src/app/api/test/e2e/auth/route.ts", ["static", "system"]],
    ["scripts/ci/timing.mjs", ["static"]],
    ["scripts/db/pg17-integration.ts", ["static", "postgres"]],
    ["scripts/db/major-browser-fixture.ts", ["static", "postgres", "system"]],
  ])("preserves source capability ownership for %s", (path, requiredJobs) => {
    expect(classifyChangedFiles([{ status: "M", paths: [path] }]).requiredJobs).toEqual(requiredJobs);
  });

  it("parses git name-status lines without depending on pnpm", () => {
    expect(parseNameStatus("M\tsrc/lib/date.ts\nA\tdocs/testing.md\n")).toEqual([
      { status: "M", paths: ["src/lib/date.ts"] },
      { status: "A", paths: ["docs/testing.md"] },
    ]);
  });

  it("fails closed when changed-surface cannot be obtained", () => {
    expect(classifyChangedFiles([]).requiredJobs).toEqual(["static", "postgres", "system"]);
  });

  it("decouples Draft and Ready PR from evidence depth and only alters gateName", () => {
    const pureUiEntry = [{ status: "M", paths: ["src/components/layout/Footer.tsx"] }];
    
    // Draft pure UI -> affected static + draft-gate
    const draft = classifyChangedFiles(pureUiEntry, { draft: true });
    expect(draft.full).toBe(false);
    expect(draft.requiredJobs).toEqual(["static"]);
    expect(draft.gateName).toBe("draft-gate");

    // Ready pure UI -> same affected static + ci-gate, NOT full
    const ready = classifyChangedFiles(pureUiEntry, { draft: false });
    expect(ready.full).toBe(false);
    expect(ready.requiredJobs).toEqual(["static"]);
    expect(ready.gateName).toBe("ci-gate");
  });

  it("keeps Ready Server Action / registration transaction on static + PG without triggering system", () => {
    const registrationAction = [{ status: "M", paths: ["src/actions/register.ts"] }];
    const plan = classifyChangedFiles(registrationAction, { draft: false });
    expect(plan.full).toBe(false);
    expect(plan.requiredJobs).toEqual(["static", "postgres"]);
    expect(plan.runSystem).toBe(false);
    expect(plan.gateName).toBe("ci-gate");
  });

  it("routes Auth and Storage providers to system", () => {
    const authProvider = classifyChangedFiles([{ status: "M", paths: ["src/lib/auth/supabase.ts"] }], { draft: false });
    expect(authProvider.requiredJobs).toContain("system");
    expect(authProvider.e2eSpecs).toEqual(["tests/e2e/flows/major-entry.spec.ts"]);

    const storageProvider = classifyChangedFiles([{ status: "M", paths: ["src/lib/education/storage.ts"] }], { draft: false });
    expect(storageProvider.requiredJobs).toContain("system");
    expect(storageProvider.e2eSpecs).toEqual(["tests/e2e/flows/education-manual-fallback.spec.ts"]);

    const educationCommands = classifyChangedFiles([{ status: "M", paths: ["src/lib/education/commands.ts"] }], { draft: false });
    expect(educationCommands.requiredJobs).toContain("system");
    expect(educationCommands.e2eSpecs).toEqual(["tests/e2e/flows/education-manual-fallback.spec.ts"]);

    const educationAction = classifyChangedFiles([{ status: "M", paths: ["src/actions/education-verifications.ts"] }], { draft: false });
    expect(educationAction.requiredJobs).toContain("system");
    expect(educationAction.e2eSpecs).toEqual(["tests/e2e/flows/education-manual-fallback.spec.ts"]);

    const educationPanel = classifyChangedFiles([{ status: "M", paths: ["src/components/settings/EducationVerificationPanel.tsx"] }], { draft: false });
    expect(educationPanel.requiredJobs).toContain("system");
    expect(educationPanel.e2eSpecs).toEqual(["tests/e2e/flows/education-manual-fallback.spec.ts"]);

    const educationValidation = classifyChangedFiles([{ status: "M", paths: ["src/lib/education/validation.ts"] }], { draft: false });
    expect(educationValidation.runSystem).toBe(false);
    expect(educationValidation.requiredJobs).not.toContain("system");
  });

  it("enforces invariant: any evidence with e2eSpecs must activate system capability", () => {
    const plan = classifyChangedFiles([{ status: "M", paths: ["src/actions/education-verifications.ts"] }], { draft: true });
    expect(plan.e2eSpecs.length).toBeGreaterThan(0);
    expect(plan.runSystem).toBe(true);
    expect(plan.requiredJobs).toContain("system");
  });

  it("keeps migration on PG without triggering system", () => {
    const migration = classifyChangedFiles([{ status: "A", paths: ["drizzle/migrations/0048_new_feature.sql"] }], { draft: false });
    expect(migration.full).toBe(false);
    expect(migration.requiredJobs).toEqual(["postgres"]);
    expect(migration.runSystem).toBe(false);
  });

  it("selects targeted system for E2E spec and falls back to full system / L4 for shared harness", () => {
    const e2eSpec = classifyChangedFiles([{ status: "M", paths: ["tests/e2e/flows/major-entry.spec.ts"] }], { draft: false });
    expect(e2eSpec.full).toBe(false);
    expect(e2eSpec.requiredJobs).toEqual(["static", "system"]);
    expect(e2eSpec.e2eSpecs).toEqual(["tests/e2e/flows/major-entry.spec.ts"]);

    const e2eFixture = classifyChangedFiles([{ status: "M", paths: ["tests/e2e/fixtures.ts"] }], { draft: false });
    expect(e2eFixture.requiredJobs).toEqual(["static", "system"]);
    expect(e2eFixture.e2eSpecs).toEqual([]); // full system suite fallback
  });

  it("fails closed to FULL for workflow, planner, toolchain, unknown, and rename/delete", () => {
    expect(classifyChangedFiles([{ status: "M", paths: [".github/workflows/ci.yml"] }]).full).toBe(true);
    expect(classifyChangedFiles([{ status: "M", paths: ["package.json"] }]).full).toBe(true);
    expect(classifyChangedFiles([{ status: "M", paths: ["unknown-tooling/something.bin"] }]).full).toBe(true);
    expect(classifyChangedFiles([{ status: "R100", paths: ["src/a.ts", "src/b.ts"] }]).full).toBe(true);
    expect(classifyChangedFiles([{ status: "D", paths: ["src/old.ts"] }]).full).toBe(true);
  });

  it("treats docs and Changeset as L0 metadata with planner + gate only", () => {
    const docsPlan = classifyChangedFiles([{ status: "M", paths: ["docs/testing.md"] }], { draft: true });
    expect(docsPlan.full).toBe(false);
    expect(docsPlan.requiredJobs).toEqual([]);
    expect(docsPlan.runStatic).toBe(false);
    expect(docsPlan.gateName).toBe("draft-gate");

    const readyDocsPlan = classifyChangedFiles([{ status: "M", paths: ["docs/testing.md"] }], { draft: false });
    expect(readyDocsPlan.full).toBe(false);
    expect(readyDocsPlan.requiredJobs).toEqual([]);
    expect(readyDocsPlan.gateName).toBe("ci-gate");
  });

  it("plans main ordinary business merge as affected instead of FULL", () => {
    const mainPushChanges = [
      { status: "M", paths: ["src/actions/register.ts"] },
      { status: "M", paths: ["src/components/ui/button.tsx"] },
    ];
    // on main push: forceFull=false, draft=false
    const mainPlan = classifyChangedFiles(mainPushChanges, { forceFull: false, draft: false });
    expect(mainPlan.full).toBe(false);
    expect(mainPlan.requiredJobs).toEqual(["static", "postgres"]);
    expect(mainPlan.runSystem).toBe(false);
    expect(mainPlan.gateName).toBe("ci-gate");
  });

  it("forces FULL for manual, release, or scheduled convergence", () => {
    const plan = classifyChangedFiles([{ status: "M", paths: ["src/components/ui/button.tsx"] }], { forceFull: true, draft: false });
    expect(plan.full).toBe(true);
    expect(plan.requiredJobs).toEqual(["static", "postgres", "system"]);
    expect(plan.gateName).toBe("ci-gate");
  });

  it("separates related sources from explicit tests and keeps global contracts executable", () => {
    const sourceChange = classifyChangedFiles([{ status: "M", paths: ["src/lib/major/opening.ts"] }], { draft: true });
    expect(sourceChange.staticMatrix).toEqual(expect.arrayContaining([
      expect.objectContaining({ task: "architecture" }),
      expect.objectContaining({ task: "unit-related-unit-domain-node", relatedSources: ["src/lib/major/opening.ts"] }),
      expect.objectContaining({ task: "unit-explicit-unit-domain-node", explicitTests: ["tests/unit/quality/architecture-boundaries.test.ts", "tests/unit/quality/product-language.test.ts"] }),
    ]));

    const e2eChange = classifyChangedFiles([{ status: "M", paths: ["tests/e2e/flows/major-entry.spec.ts"] }], { draft: true });
    expect(e2eChange.staticMatrix).toEqual(expect.arrayContaining([
      expect.objectContaining({ task: "unit-explicit-unit-domain-node", explicitTests: ["tests/unit/quality/e2e-contract.test.ts"] }),
    ]));
  });

  it("does not send generated migration metadata to eslint", () => {
    const result = classifyChangedFiles([
      { status: "A", paths: ["drizzle/migrations/meta/0047_snapshot.json"] },
      { status: "M", paths: ["drizzle/migrations/meta/_journal.json"] },
      { status: "M", paths: ["scripts/db/scheduler.ts"] },
    ], { draft: true });

    expect(result.staticMatrix).toEqual(expect.arrayContaining([
      expect.objectContaining({ task: "lint-changed", changedPaths: ["scripts/db/scheduler.ts"] }),
    ]));
  });
});
