import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rivalHubEventsResponseSchema } from "@/lib/demo-integration/contracts";
import { projectDemoStatus } from "@/lib/demo-integration/read";

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
});
