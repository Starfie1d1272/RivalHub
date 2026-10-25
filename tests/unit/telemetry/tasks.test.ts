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
  it("shares retries, retains independent scopes, and makes receipts idempotent", () => {
    const f = fixture();
    const first = f.tasks.begin("score_entry", "private-map-one");
    f.tasks.step("score_entry", "recognize");
    expect(f.tasks.begin("score_entry", "private-map-one")).toBe(first);
    const second = f.tasks.begin("score_entry", "private-map-two");
    f.tasks.finish("score_entry", "complete", first);
    expect(f.reports.filter(r => r.task.phase === "complete")).toHaveLength(1);
    expect(f.reports.at(-1)?.task.attemptId).toBe(first);
    f.tasks.finish("score_entry", "complete", second);
    f.tasks.finish("score_entry", "complete", second);
    expect(f.reports.filter(r => r.task.phase === "complete")).toHaveLength(2);
    expect(JSON.stringify(f.reports)).not.toContain("private-map");
  });
  it("does not infer presentation from an acknowledgement or attach an ambiguous action", () => {
    const f = fixture(); const a = f.tasks.begin("profile", "one");
    f.tasks.begin("profile", "two");
    expect(f.tasks.capture("profile")).toBeUndefined();
    expect(f.tasks.capture("profile", "one")?.attemptId).toBe(a);
    f.tasks.finish("profile", "complete", a, "two");
    expect(f.reports.some(r => r.task.phase === "complete")).toBe(false);
    f.tasks.finish("profile", "complete", a, "one");
    expect(f.reports.at(-1)?.task).toMatchObject({ phase: "complete", step: "confirm" });
    f.tasks.step("profile", "result", a, "one");
    expect(f.reports.at(-1)?.task).toMatchObject({ phase: "step", step: "result" });
  });
  it("bounds detached attempts and records explicit local eviction reasons at the 24h boundary", () => {
    const f = fixture(); const a = f.tasks.begin("registration", "one");
    f.advance(24 * 3600_000); f.tasks.finish("registration", "complete", a);
    expect(f.reports.at(-1)).toMatchObject({ durationMs: 3600_000, task: { phase: "complete" } });
    f.advance(1); f.tasks.checkpoint();
    expect(f.tasks.evictions.expired).toBe(1);
    const b = f.tasks.begin("team_registration", "two");
    f.advance(24 * 3600_000 + 1); f.tasks.finish("team_registration", "complete", b);
    expect(f.reports.filter(r => r.task.phase === "complete")).toHaveLength(1);
    for (let i = 0; i < 9; i++) f.tasks.begin("profile", String(i));
    expect(f.tasks.evictions.capacity).toBe(1);
    f.tasks.reset(); expect(f.tasks.evictions.reset).toBe(8);
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

it("keeps v2 censor flags explicit without enlarging clocks and invalidates cancelled terminal tokens", () => {
  let now = 0; const reports: TaskReport[] = [];
  const tasks = new TelemetryTasks(r => reports.push(r), () => now, () => id, () => true, 2);
  const token = tasks.begin("registration", "scope");
  for (let minute = 1; minute <= 60; minute++) { now = minute * 60000; tasks.activity("registration", token); }
  tasks.step("registration", "submit", token);
  expect(reports.at(-1)?.task).toMatchObject({ definitionVersion: 2, activeMs: 3600000 });
  expect(reports.at(-1)?.task).not.toHaveProperty("activeCensored");
  expect(reports.at(-1)?.task).not.toHaveProperty("elapsedCensored");
  now++; tasks.finish("registration", "complete", token);
  expect(reports.at(-1)).toMatchObject({ durationMs: 3600000, task: { elapsedCensored: true, activeCensored: true } });
  const count = reports.length; tasks.reset(); tasks.step("registration", "result", token);
  expect(reports).toHaveLength(count);
  const cancelled = tasks.begin("profile", "scope"); tasks.finish("profile", "cancel", cancelled);
  const afterCancel = reports.length; tasks.step("profile", "result", cancelled); tasks.finish("profile", "complete", cancelled);
  expect(reports).toHaveLength(afterCancel);
});
