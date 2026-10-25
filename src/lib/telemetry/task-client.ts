import { TASKS, TASK_DURATION_CAP_MS, type TaskMeasurement, type TaskName, type TaskStep, type TaskValidationReason } from "./task-contract";

type Attempt = { name: TaskName; id: string; scope: string; started: number; checkpoint: number; activity: number | null; activeMs: number; step: TaskStep; reportedMs: number; activeCensored?: true; terminal?: "complete" | "cancel" };
export type TaskReport = { task: TaskMeasurement; durationMs: number };
/** Raw names/scopes and eviction diagnostics stay in memory, never in telemetry. */
export class TelemetryTasks {
  private attempts = new Map<string, Attempt>();
  readonly evictions = { expired: 0, capacity: 0, forgotten: 0, reset: 0 };
  constructor(private emit: (report: TaskReport) => void, private now = () => performance.now(), private id = () => crypto.randomUUID(), private visible = () => true, private definitionVersion: 1 | 2 = 1) {}
  private prune() {
    for (const [id, a] of this.attempts) {
      if (this.now() - a.started > TASKS[a.name].windowMs) { this.attempts.delete(id); this.evictions.expired++; }
    }
  }
  private find(name: TaskName, expected?: string | null, scope?: string) {
    this.prune();
    if (expected === null) return;
    const a = expected === undefined
      ? [...this.attempts.values()].reverse().find(a => a.name === name && !a.terminal && (scope === undefined || a.scope === scope))
      : this.attempts.get(expected);
    return a?.name === name && (scope === undefined || a.scope === scope) ? a : undefined;
  }
  private accumulate(a: Attempt) {
    const now = this.now();
    if (!a.terminal && a.activity !== null) a.activeMs += Math.max(0, Math.min(now, a.activity + 60_000) - a.checkpoint);
    if (a.activeMs > TASK_DURATION_CAP_MS) a.activeCensored = true;
    a.activeMs = Math.min(TASK_DURATION_CAP_MS, a.activeMs);
    a.checkpoint = now;
    return now;
  }
  private payload(a: Attempt, phase: TaskMeasurement["phase"]): TaskMeasurement {
    return { name: a.name, definitionVersion: this.definitionVersion, ...(this.definitionVersion === 2 && this.now() - a.started > TASK_DURATION_CAP_MS ? { elapsedCensored: true as const } : {}), ...(this.definitionVersion === 2 && a.activeCensored ? { activeCensored: true as const } : {}), attemptId: a.id, step: a.step, phase, activeMs: Math.round(a.activeMs) };
  }
  private report(a: Attempt, phase: TaskMeasurement["phase"]) {
    const now = this.accumulate(a);
    this.emit({ task: this.payload(a, phase), durationMs: Math.min(TASK_DURATION_CAP_MS, Math.max(0, Math.round(now - a.started))) });
    a.reportedMs = a.activeMs;
  }
  begin(name: TaskName, scope: string, step: TaskStep = "edit"): string {
    let a = this.find(name, undefined, scope);
    const now = this.now();
    if (!a) {
      if (this.attempts.size >= 8) { this.attempts.delete(this.attempts.keys().next().value!); this.evictions.capacity++; }
      a = { name, scope, id: this.id(), started: now, checkpoint: now, activity: this.visible() ? now : null, activeMs: 0, step, reportedMs: 0 };
      this.attempts.set(a.id, a);
      this.report(a, "start");
    } else this.activity(name, a.id, scope);
    return a.id;
  }
  activity(name: TaskName, expected?: string | null, scope?: string) {
    const a = this.find(name, expected, scope);
    if (!a || a.terminal) return;
    this.accumulate(a); a.activity = this.visible() ? this.now() : null;
  }
  step(name: TaskName, step: TaskStep, expected?: string | null, scope?: string) {
    const a = this.find(name, expected, scope);
    if (!a || a.terminal === "cancel" || (a.terminal && step !== "result" && step !== "ready")) return;
    // An async response changes the step, not the last user-interaction time.
    this.accumulate(a);
    if (a.step === step) return;
    a.step = step; this.report(a, "step");
  }
  validation(name: TaskName, reason: TaskValidationReason, expected?: string | null, scope?: string) {
    const a = this.find(name, expected, scope);
    if (!a || a.terminal) return;
    this.activity(name, a.id, scope); a.step = "validation";
    this.emit({ task: { ...this.payload(a, "step"), validationReason: reason }, durationMs: Math.min(TASK_DURATION_CAP_MS, Math.max(0, Math.round(this.now() - a.started))) });
  }
  finish(name: TaskName, phase: "complete" | "cancel", expected?: string | null, scope?: string) {
    const a = this.find(name, expected, scope);
    if (!a) return;
    // Cancelling presentation after an ACK must not retract the confirmed fact,
    // but it invalidates this token for every later UI step.
    if (phase === "cancel" && a.terminal === "complete") { a.terminal = "cancel"; return; }
    if (a.terminal) return;
    // An acknowledged mutation is not evidence that React presented its result.
    if (phase === "complete") a.step = name === "score_entry" ? "result" : "confirm";
    this.report(a, phase); a.terminal = phase; a.activity = null;
  }
  capture(name: TaskName, scopePrefix?: string): TaskMeasurement | undefined {
    // An action without an explicit token cannot choose among concurrent scopes.
    this.prune();
    const candidates = [...this.attempts.values()].filter(a => a.name === name && !a.terminal && (scopePrefix === undefined || a.scope.startsWith(scopePrefix)));
    if (candidates.length !== 1) return;
    this.accumulate(candidates[0]);
    return this.payload(candidates[0], "step");
  }
  pause() { this.prune(); for (const a of this.attempts.values()) { this.accumulate(a); a.activity = null; } }
  checkpoint() {
    this.prune();
    for (const a of this.attempts.values()) {
      if (a.terminal) continue;
      this.accumulate(a);
      if (a.activeMs > a.reportedMs) this.report(a, "step");
    }
  }
  forget(name: TaskName, expected?: string | null, scope?: string) {
    const a = this.find(name, expected, scope);
    if (a) { this.attempts.delete(a.id); this.evictions.forgotten++; }
  }
  reset() { this.evictions.reset += this.attempts.size; this.attempts.clear(); }
}
