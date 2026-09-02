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

  it("maps domain, database, and app changes to the smallest evidence set", () => {
    const result = classifyChangedFiles([
      { status: "M", paths: ["src/lib/major/opening.ts"] },
      { status: "M", paths: ["src/db/schema/major.ts"] },
      { status: "M", paths: ["src/app/admin/[seasonSlug]/page.tsx"] },
    ]);
    expect(result.requiredJobs).toEqual(["static", "postgres", "system"]);
    expect(result.full).toBe(false);
  });

  it("requires database and system evidence for auth changes", () => {
    const result = classifyChangedFiles([
      { status: "M", paths: ["src/lib/auth/session.ts"] },
    ]);
    expect(result.requiredJobs).toEqual(["static", "postgres", "system"]);
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
