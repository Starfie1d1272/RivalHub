import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rivalHubEventsResponseSchema } from "@/lib/demo-integration/contracts";
import { projectDemoIssues, projectDemoStatus } from "@/lib/demo-integration/read";

describe("rivalhub-dak-events/1 fixture", () => {
  it("is accepted by RivalHub's response schema", () => {
    const fixture = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/contracts/rivalhub-dak-events-1.json"), "utf8"));
    expect(rivalHubEventsResponseSchema.parse(fixture)).toEqual(fixture);
  });

  it("projects map status from map completion instead of the whole match status", () => {
    expect(projectDemoStatus(
      { status: "in_progress" },
      { completedAt: new Date("2026-09-13T00:00:00.000Z"), scoreA: 13, scoreB: 9 },
      undefined,
    )).toBe("finished_pending_demo");
    expect(projectDemoStatus(
      { status: "in_progress" },
      { completedAt: null, scoreA: null, scoreB: null },
      undefined,
    )).toBe("not_started");
  });

  it("projects a confirmed import as stale when its evidence context revision changed", () => {
    const confirmed = {
      status: "confirmed",
      evidenceRevision: "revision-n",
      issues: [],
    } as unknown as Parameters<typeof projectDemoStatus>[2];

    expect(projectDemoStatus(
      { status: "in_progress" },
      { completedAt: new Date("2026-09-13T00:00:00.000Z"), scoreA: 13, scoreB: 9 },
      confirmed,
      "revision-n",
    )).toBe("synced");
    expect(projectDemoStatus(
      { status: "in_progress" },
      { completedAt: new Date("2026-09-13T00:00:00.000Z"), scoreA: 13, scoreB: 9 },
      confirmed,
      "revision-n-plus-one",
    )).toBe("needs_attention");
    expect(projectDemoIssues(confirmed, confirmed, "revision-n-plus-one")).toEqual([
      expect.objectContaining({ code: "STALE_EVIDENCE" }),
    ]);
  });
});
