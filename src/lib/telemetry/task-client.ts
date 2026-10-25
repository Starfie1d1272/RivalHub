import { TASKS, type TaskMeasurement, type TaskName, type TaskStep, type TaskValidationReason } from "./task-contract";

type Attempt = { name: TaskName; id: string; scope: string; started: number; checkpoint: number; activity: number | null; activeMs: number; step: TaskStep; reportedMs: number };
export type TaskReport = { task: TaskMeasurement; durationMs: number };
/** Task identity and scope stay in memory; emitted fields are finite categories and random IDs. */
export class TelemetryTasks {
  private attempts = new Map<TaskName, Attempt>();
  constructor(private emit: (report: TaskReport) => void, private now = () => performance.now(), private id = () => crypto.randomUUID()) {}
  private accumulate(a: Attempt) {
    const now = this.now();
    if (a.activity !== null) a.activeMs += Math.max(0, Math.min(now, a.activity + 60_000) - a.checkpoint);
    a.activeMs = Math.min(3600_000, a.activeMs);
    a.checkpoint = now;
    return now;
  }
  private payload(a: Attempt, phase: TaskMeasurement["phase"]): TaskMeasurement {
    return { name: a.name, definitionVersion: 1, attemptId: a.id, step: a.step, phase, activeMs: Math.round(a.activeMs) };
  }
  private report(a: Attempt, phase: TaskMeasurement["phase"]) {
    const now = this.accumulate(a);
    this.emit({ task: this.payload(a, phase), durationMs: Math.min(3600_000, Math.max(0, Math.round(now - a.started))) });
    a.reportedMs = a.activeMs;
  }
  begin(name: TaskName, scope: string, step: TaskStep = "edit"): string {
    let a = this.attempts.get(name);
    const now = this.now();
    if (a && (a.scope !== scope || now - a.started > TASKS[name].windowMs)) { this.attempts.delete(name); a = undefined; }
    if (!a) {
      if (this.attempts.size >= 8) this.attempts.delete(this.attempts.keys().next().value!);
      a = { name, scope, id: this.id(), started: now, checkpoint: now, activity: now, activeMs: 0, step, reportedMs: 0 };
      this.attempts.set(name, a);
      this.report(a, "start");
    } else this.activity(name);
    return a.id;
  }
  activity(name: TaskName) {
    const a = this.attempts.get(name);
    if (!a) return;
    this.accumulate(a); a.activity = this.now();
  }
  step(name: TaskName, step: TaskStep, expected?: string | null) {
    const a = this.attempts.get(name);
    if (!a || (expected !== undefined && a.id !== expected)) return;
    this.activity(name);
    if (a.step === step) return;
    a.step = step; this.report(a, "step");
  }
  validation(name: TaskName, reason: TaskValidationReason, expected?: string | null) {
    const a = this.attempts.get(name);
    if (!a || (expected !== undefined && a.id !== expected)) return;
    this.activity(name); a.step = "validation";
    this.emit({ task: { ...this.payload(a, "step"), validationReason: reason }, durationMs: Math.min(3600_000, Math.max(0, Math.round(this.now() - a.started))) });
  }
  finish(name: TaskName, phase: "complete" | "cancel", expected?: string | null) {
    const a = this.attempts.get(name);
    if (!a || (expected !== undefined && a.id !== expected)) return;
    a.step = phase === "complete" ? "result" : a.step;
    this.report(a, phase); this.attempts.delete(name);
  }
  capture(name: TaskName): TaskMeasurement | undefined {
    const a = this.attempts.get(name);
    if (!a) return;
    this.accumulate(a);
    return this.payload(a, "step");
  }
  pause() { for (const a of this.attempts.values()) { this.accumulate(a); a.activity = null; } }
  checkpoint() {
    for (const a of this.attempts.values()) {
      this.accumulate(a);
      if (a.activeMs > a.reportedMs) this.report(a, "step");
    }
  }
  forget(name: TaskName, expected?: string | null) {
    const a = this.attempts.get(name);
    if (a && (expected === undefined || a.id === expected)) this.attempts.delete(name);
  }
  reset() { this.attempts.clear(); }
}
