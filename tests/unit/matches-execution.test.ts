import { describe, expect, it } from "vitest";
import { concludeMatchExecution, transitionMatchExecution } from "@/lib/matches/execution";

const now = new Date("2026-10-07T12:00:00Z");
const match = { status: "scheduled" as const, startedAt: null, completedAt: null, format: "bo3" as const };

describe("competition-independent match execution", () => {
  it("starts without an event, roster, schedule, BP or telemetry", () => {
    expect(transitionMatchExecution(match, "in_progress", now)).toEqual({ status: "in_progress", startedAt: now, updatedAt: now });
  });
  it("keeps known start time and rejects restarting ended execution", () => {
    expect(transitionMatchExecution({ ...match, startedAt: now }, "in_progress", now)).not.toHaveProperty("startedAt");
    expect(() => transitionMatchExecution({ ...match, status: "finished" }, "in_progress", now)).toThrow();
  });
  it("distinguishes awaiting results from intentionally unreported results", () => {
    const playing = { ...match, status: "in_progress" as const };
    const pending = concludeMatchExecution(playing, { kind: "pending" }, now);
    const omitted = concludeMatchExecution(playing, { kind: "omitted" }, now);
    expect(pending.result.kind).toBe("pending");
    expect(omitted.result.kind).toBe("omitted");
    for (const result of [pending, omitted]) {
      expect(result.status).toBe("finished");
      expect(result.scoreA).toBeNull();
      expect(result.scoreB).toBeNull();
    }
  });
  it("validates recorded series through the existing score rules", () => {
    expect(() => concludeMatchExecution(match, { kind: "recorded", scoreA: 1, scoreB: 0 }, now)).toThrow();
    expect(concludeMatchExecution(match, { kind: "recorded", scoreA: 2, scoreB: 1 }, now)).toMatchObject({ status: "finished", scoreA: 2, scoreB: 1 });
  });
  it("does not turn cancellation into an unreported result", () => {
    expect(() => concludeMatchExecution({ ...match, status: "cancelled" }, { kind: "omitted" }, now)).toThrow();
  });
});
