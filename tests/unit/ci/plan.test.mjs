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
    ["src/app/[seasonSlug]/register/page.tsx", ["static", "postgres", "system"]],
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

  it("uses the full evidence plan for a Ready PR while Draft PRs stay affected", () => {
    const entry = [{ status: "M", paths: ["tests/unit/components/Foo.test.tsx"] }];
    const draft = classifyChangedFiles(entry, { draft: true });
    expect(draft.full).toBe(false);
    expect(draft.staticMatrix).toEqual(expect.arrayContaining([
      expect.objectContaining({ task: "type-tests" }),
      expect.objectContaining({ task: "unit-related-unit-react-jsdom", mode: "related" }),
    ]));

    const ready = classifyChangedFiles(entry, { draft: false });
    expect(ready.full).toBe(true);
    expect(ready.staticMatrix.map(({ task }) => task)).toContain("unit-react");
    expect(ready.staticMatrix.map(({ task }) => task)).toContain("build");
  });

  it("selects conservative PG and browser evidence for affected draft changes", () => {
    const result = classifyChangedFiles([
      { status: "M", paths: ["tests/integration/db/team-registration.test.ts"] },
      { status: "M", paths: ["src/app/team-invites/[token]/page.tsx"] },
    ], { draft: true });

    expect(result.integrationSpecs).toEqual(["tests/integration/db/team-registration.test.ts"]);
    expect(result.e2eSpecs).toEqual(["tests/e2e/flows/team-invitations.spec.ts"]);
    expect(result.staticMatrix).toEqual(expect.arrayContaining([
      expect.objectContaining({ task: "type-app" }),
      expect.objectContaining({ task: "type-tests" }),
    ]));
  });
});
