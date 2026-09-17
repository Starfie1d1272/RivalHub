import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rivalHubEventsResponseSchema } from "@/lib/demo-integration/contracts";
import { projectDemoIssues, projectDemoStatus, selectCurrentDemoImport } from "@/lib/demo-integration/read";
import { isRetiredDakSemanticProfile } from "@/lib/demo-integration/semantic-profile";

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

  it("keeps a late retired profile out of the active read model", () => {
    const legacyV1 = {
      id: "legacy-v1",
      semanticProfile: "dak-stable/1",
      status: "needs_attention",
    } as unknown as Parameters<typeof selectCurrentDemoImport>[0][number];
    const legacyV2 = {
      id: "legacy-v2",
      semanticProfile: "dak-stable/2",
      status: "confirmed",
    } as unknown as Parameters<typeof selectCurrentDemoImport>[0][number];
    const current = {
      id: "current",
      semanticProfile: "dak-stable/3",
      status: "confirmed",
    } as unknown as Parameters<typeof selectCurrentDemoImport>[0][number];

    expect(selectCurrentDemoImport([legacyV1, legacyV2, current])).toBe(current);
    expect(selectCurrentDemoImport([legacyV1, legacyV2])).toBeUndefined();
    expect(isRetiredDakSemanticProfile(legacyV1.semanticProfile)).toBe(true);
    expect(isRetiredDakSemanticProfile(legacyV2.semanticProfile)).toBe(true);
    expect(projectDemoStatus(
      { status: "in_progress" },
      { completedAt: new Date("2026-09-13T00:00:00.000Z"), scoreA: 13, scoreB: 9 },
      legacyV2,
    )).toBe("needs_attention");
    expect(projectDemoIssues(legacyV2, undefined, "revision")).toEqual([
      expect.objectContaining({ code: "UNSUPPORTED_SEMANTIC_PROFILE" }),
    ]);
  });
});
