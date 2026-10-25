import { describe, expect, it } from "vitest";
import { TelemetryTasks, type TaskReport } from "@/lib/telemetry/task-client";
import { OPERATIONS } from "@/lib/telemetry/operations";
import { TASKS, taskForOperation } from "@/lib/telemetry/task-contract";
import { validEvent } from "@/lib/telemetry/protocol";

const id = "00000000-0000-4000-8000-000000000001";
function fixture() {
  let now = 0, next = 0;
  const reports: TaskReport[] = [];
  const tasks = new TelemetryTasks(r => reports.push(r), () => now, () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`);
  return { tasks, reports, advance: (ms: number) => { now += ms; } };
}
describe("task collection boundaries", () => {
  it("maps every registered operation and leaves unregistered operations unknown", () => {
    expect(OPERATIONS.every(op => Boolean(taskForOperation(op) && taskForOperation(op)! in TASKS))).toBe(true);
    expect(taskForOperation("private.input")).toBeUndefined();
  });
  it("shares retries, separates another scope, and rejects a late completion", () => {
    const f = fixture();
    const first = f.tasks.begin("score_entry", "private-map-one");
    f.tasks.step("score_entry", "recognize");
    expect(f.tasks.begin("score_entry", "private-map-one")).toBe(first);
    const second = f.tasks.begin("score_entry", "private-map-two");
    f.tasks.finish("score_entry", "complete", first);
    expect(f.reports.filter(r => r.task.phase === "complete")).toHaveLength(0);
    f.tasks.finish("score_entry", "complete", second);
    f.tasks.finish("score_entry", "complete", second);
    expect(f.reports.filter(r => r.task.phase === "complete")).toHaveLength(1);
    expect(JSON.stringify(f.reports)).not.toContain("private-map");
  });
  it("counts visible recent activity once and pauses hidden or idle periods", () => {
    const f = fixture(); f.tasks.begin("profile", "scope");
    f.advance(90_000); f.tasks.checkpoint();
    expect(f.reports.at(-1)?.task.activeMs).toBe(60_000);
    f.tasks.activity("profile"); f.advance(10_000); f.tasks.pause(); f.advance(100_000);
    f.tasks.activity("profile"); f.advance(5000); f.tasks.finish("profile", "complete");
    expect(f.reports.at(-1)).toMatchObject({ durationMs: 205_000, task: { activeMs: 75_000, phase: "complete" } });
  });
  it("does not restart active time from asynchronous steps while idle or hidden", () => {
    let now = 0, visible = true;
    const reports: TaskReport[] = [];
    const tasks = new TelemetryTasks(r => reports.push(r), () => now, () => id, () => visible);
    tasks.begin("score_entry", "scope");
    now = 90_000; tasks.step("score_entry", "review");
    now = 100_000; tasks.pause(); visible = false;
    now = 110_000; tasks.begin("score_entry", "scope");
    tasks.step("score_entry", "submit");
    now = 150_000; tasks.finish("score_entry", "complete");
    expect(reports.at(-1)?.task.activeMs).toBe(60_000);
  });
  it("drops task identity on reset and ages out unresolved attempts", () => {
    const f = fixture(); const first = f.tasks.begin("profile", "scope");
    f.advance(TASKS.profile.windowMs + 1);
    expect(f.tasks.begin("profile", "scope")).not.toBe(first);
    f.tasks.reset(); f.tasks.finish("profile", "complete");
    expect(f.reports.every(r => r.task.phase !== "complete")).toBe(true);
  });
  it("rejects free text, unknown task fields, and task metadata on unrelated events", () => {
    const event = { id, session: id, at: 1000, route: "/", scene: "site", kind: "task", durationMs: 200, task: { name: "profile", definitionVersion: 1, attemptId: id, step: "result", phase: "complete", activeMs: 100 } };
    expect(validEvent(event, 1000)).toBe(true);
    expect(validEvent({ ...event, task: { ...event.task, input: "private" } }, 1000)).toBe(false);
    expect(validEvent({ ...event, task: { ...event.task, step: "private" } }, 1000)).toBe(false);
    expect(validEvent({ ...event, kind: "page" }, 1000)).toBe(false);
    expect(validEvent({ ...event, task: { ...event.task, step: "validation", validationReason: "PRIVATE" } }, 1000)).toBe(false);
    expect(validEvent({ ...event, task: { ...event.task, step: "validation", validationReason: "required" } }, 1000)).toBe(true);
    expect(validEvent({ ...event, task: { ...event.task, activeMs: -1 } }, 1000)).toBe(false);
  });
});
