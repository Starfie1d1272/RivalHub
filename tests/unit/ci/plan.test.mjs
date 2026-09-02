import { describe, expect, it } from "vitest";
import { classifyChangedFiles, parseNameStatus } from "../../../scripts/ci/plan.mjs";

describe("changed-surface planner", () => {
  it("keeps documentation-only changes on the planner gate", () => {
    const result = classifyChangedFiles([
      { status: "M", paths: ["docs/testing.md"] },
      { status: "M", paths: ["README.md"] },
    ]);
    expect(result.requiredJobs).toEqual([]);
    expect(result.full).toBe(false);
  });

  it.each([
    ["src/components/layout/Footer.tsx", ["static"]],
    ["src/lib/major/opening.ts", ["static"]],
    ["src/lib/data/standings.ts", ["static", "postgres"]],
    ["src/actions/competitive-profile.ts", ["static", "postgres"]],
    ["src/actions/recruitment.ts", ["static", "postgres"]],
    ["src/actions/auth.ts", ["static", "postgres", "system"]],
    ["src/lib/auth/supabase.ts", ["static", "system"]],
    ["src/actions/teams.ts", ["static", "postgres", "system"]],
    ["src/actions/competition-entries.ts", ["static", "postgres", "system"]],
    ["src/app/privacy/page.tsx", ["static"]],
    ["src/app/login/page.tsx", ["static", "system"]],
    ["src/app/auth/confirmation/page.tsx", ["static", "system"]],
    ["src/app/[seasonSlug]/register/page.tsx", ["static", "postgres", "system"]],
    ["src/app/[seasonSlug]/page.tsx", ["static", "postgres"]],
    ["src/app/my/teams/page.tsx", ["static", "postgres", "system"]],
    ["src/db/schema/major-stage.ts", ["static", "postgres"]],
    ["drizzle/migrations/0032_competitive_fact_states.sql", ["postgres"]],
    ["supabase/config.toml", ["system"]],
  ])("classifies one changed file %s as %j", (path, requiredJobs) => {
    const result = classifyChangedFiles([{ status: "M", paths: [path] }]);
    expect(result.requiredJobs).toEqual(requiredJobs);
    expect(result.full).toBe(false);
  });

  it("keeps the session boundary on all three evidence lanes", () => {
    expect(classifyChangedFiles([{ status: "M", paths: ["src/lib/auth/session.ts"] }]).requiredJobs).toEqual([
      "static",
      "postgres",
      "system",
    ]);
  });

  it("fails closed for renames, deletes, and unclassified files", () => {
    expect(classifyChangedFiles([{ status: "R100", paths: ["src/a.ts", "src/b.ts"] }]).full).toBe(true);
    expect(classifyChangedFiles([{ status: "D", paths: ["src/a.ts"] }]).full).toBe(true);
    expect(classifyChangedFiles([{ status: "M", paths: ["tooling/unknown.bin"] }]).full).toBe(true);
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
});
