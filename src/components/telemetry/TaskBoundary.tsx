"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { exposeTelemetryTask, recordTaskValidation, activityTelemetryTask, beginTelemetryTask, cancelTelemetryTask, completeTelemetryTask, forgetTelemetryTask, stepTelemetryTask } from "@/lib/telemetry/client";
import type { TaskName, TaskStep, TaskValidationReason } from "@/lib/telemetry/task-contract";

export function useTelemetryTask(task: TaskName, scope = "", eligible = false) {
  useEffect(() => {
    if (!eligible) return;
    const timer = setTimeout(() => exposeTelemetryTask(task, scope), 0);
    return () => clearTimeout(timer);
  }, [task, scope, eligible]);
  const token = useRef<string | null>(null);
  const [completed, setCompleted] = useState<string | null>(null);
  useEffect(() => () => { forgetTelemetryTask(task, token.current); token.current = null; }, [task, scope]);
  useEffect(() => { if (completed) completeTelemetryTask(task, completed); }, [task, completed]);
  const begin = useCallback((step: TaskStep = "edit") => { token.current = beginTelemetryTask(task, scope, step); return token.current; }, [task, scope]);
  const step = useCallback((step: TaskStep, captured = token.current) => stepTelemetryTask(task, step, captured), [task]);
  const validation = useCallback((reason: TaskValidationReason, captured = token.current) => recordTaskValidation(task, reason, captured), [task]);
  const complete = useCallback((captured = token.current) => setCompleted(captured), []);
  const cancel = useCallback(() => cancelTelemetryTask(task, token.current), [task]);
  const activity = useCallback(() => activityTelemetryTask(task), [task]);
  return { begin, step, validation, complete, cancel, activity };
}

/** Only semantic activity is counted; event targets and input values are never read. */
export function TaskBoundary({ task, scope = "", children, className }: { task: TaskName; scope?: string; children: ReactNode; className?: string }) {
  const tracker = useTelemetryTask(task, scope);
  return <div className={className} onInputCapture={() => tracker.begin()} onSubmitCapture={() => { tracker.begin(); tracker.step("submit"); }} onInvalidCapture={() => { tracker.begin(); tracker.validation("form_invalid"); }} onPointerDownCapture={tracker.activity} onKeyDownCapture={tracker.activity}>{children}</div>;
}
