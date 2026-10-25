import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Reporter } from "@playwright/test/reporter";

type ExitStage = "before-html.onEnd" | "after-html.onEnd" | "before-html.onExit" | "after-html.onExit" | "playwright.exit" | "playwright.start" | "playwright.return" | "fixture-cleanup.start" | "fixture-cleanup.return" | "wrapper.return";
type DiagnosticHandle = { constructor?: { name?: string }; pid?: number; fd?: number };

/** CI diagnostics only: fixed stages and handle types, never argv, env or payload. */
export function recordE2EExitStage(stage: ExitStage, exitCode?: number): void {
  if (!process.env.CI) return;
  try {
    const handles = (process as NodeJS.Process & { _getActiveHandles?: () => DiagnosticHandle[] })._getActiveHandles?.() ?? [];
    const entry = { kind: "e2e-exit-boundary", stage, pid: process.pid, at: Date.now(), exitCode,
      resources: process.getActiveResourcesInfo(), handles: handles.map(handle => ({ type: handle.constructor?.name, pid: handle.pid, fd: handle.fd })),
      stdoutLength: process.stdout.writableLength, stderrLength: process.stderr.writableLength };
    const directory = resolve(process.cwd(), ".agent-tmp");
    mkdirSync(directory, { recursive: true });
    appendFileSync(resolve(directory, "e2e-exit-boundary.jsonl"), `${JSON.stringify(entry)}\n`, "utf8");
    // File persistence also covers an explicit process.exit whose stderr may not flush.
    if (stage !== "playwright.exit") process.stderr.write(`${JSON.stringify(entry)}\n`);
  } catch { /* Diagnostic persistence must not change the test or cleanup result. */ }
}

export default class ExitBoundaryReporter implements Reporter {
  private readonly phase: "before-html" | "after-html";
  constructor(options: { phase?: string } = {}) {
    this.phase = options.phase === "before-html" ? "before-html" : "after-html";
    if (this.phase === "before-html") process.once("exit", code => recordE2EExitStage("playwright.exit", code));
  }
  printsToStdio() { return false; }
  onEnd() { recordE2EExitStage(`${this.phase}.onEnd`); }
  async onExit() { recordE2EExitStage(`${this.phase}.onExit`); }
}
