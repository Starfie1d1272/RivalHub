"use client";
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { exposeTelemetryTask, recordTaskValidation, activityTelemetryTask, beginTelemetryTask, cancelTelemetryTask, completeTelemetryTask, stepTelemetryTask } from "@/lib/telemetry/client";
import type { TaskName, TaskStep, TaskValidationReason } from "@/lib/telemetry/task-contract";

export function useTelemetryTask(task: TaskName, scope = "", eligible = false) {
  useEffect(() => {
    if (!eligible) return;
    const timer = setTimeout(() => exposeTelemetryTask(task, scope), 0);
    return () => clearTimeout(timer);
  }, [task, scope, eligible]);
  const tokens = useRef(new Map<string, string | null>());
  const key = `${task}:${scope}`;
  const begin = useCallback((step: TaskStep = "edit") => {
    const captured = beginTelemetryTask(task, scope, step);
    tokens.current.set(key, captured);
    if (tokens.current.size > 8) tokens.current.delete(tokens.current.keys().next().value!);
    return captured;
  }, [task, scope, key]);
  const step = useCallback((step: TaskStep, captured = tokens.current.get(key) ?? null) => stepTelemetryTask(task, step, captured), [task, key]);
  const validation = useCallback((reason: TaskValidationReason, captured = tokens.current.get(key) ?? null) => recordTaskValidation(task, reason, captured), [task, key]);
  // The receipt survives synchronous unmount; unfinished attempts expire without completion.
  const complete = useCallback((captured = tokens.current.get(key) ?? null) => completeTelemetryTask(task, captured), [task, key]);
  const cancel = useCallback(() => cancelTelemetryTask(task, tokens.current.get(key) ?? null), [task, key]);
  const activity = useCallback(() => activityTelemetryTask(task, tokens.current.get(key) ?? null), [task, key]);
  return { begin, step, validation, complete, cancel, activity };
}

/** Only semantic activity is counted; event targets and input values are never read. */
export function TaskBoundary({ task, scope = "", children, className }: { task: TaskName; scope?: string; children: ReactNode; className?: string }) {
  const tracker = useTelemetryTask(task, scope);
  return <div className={className} onInputCapture={() => tracker.begin()} onSubmitCapture={() => { tracker.begin(); tracker.step("submit"); }} onInvalidCapture={() => { tracker.begin(); tracker.validation("form_invalid"); }} onPointerDownCapture={tracker.activity} onKeyDownCapture={tracker.activity}>{children}</div>;
}
