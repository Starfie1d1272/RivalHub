import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Reporter, TestModule } from "vitest/node";

type ProjectRecord = {
  kind: "vitest-project";
  project: string;
  milliseconds: number;
  files: number;
  tests: number;
  failed: number;
  flaky: number;
};

function statePath(): string {
  return process.env.RIVALHUB_TIMING_FILE
    ?? resolve(process.env.RUNNER_TEMP ?? ".agent-tmp", `rivalhub-timing-${process.env.GITHUB_JOB ?? "local"}.jsonl`);
}

export default class VitestTimingReporter implements Reporter {
  onTestRunEnd(testModules: ReadonlyArray<TestModule>): void {
    if (process.env.RIVALHUB_TIMING !== "1") return;

    const grouped = new Map<string, TestModule[]>();
    for (const testModule of testModules) {
      const project = testModule.project.name || "root";
      const modules = grouped.get(project) ?? [];
      modules.push(testModule);
      grouped.set(project, modules);
    }

    const path = statePath();
    mkdirSync(dirname(path), { recursive: true });
    for (const [project, modules] of grouped) {
      const diagnostics = modules.map((testModule) => testModule.diagnostic()).filter(Boolean);
      const tests = modules.flatMap((testModule) => [...testModule.children.allTests()]);
      const record: ProjectRecord = {
        kind: "vitest-project",
        project,
        milliseconds: diagnostics.reduce((total, diagnostic) => total + diagnostic!.duration, 0),
        files: modules.length,
        tests: tests.length,
        failed: tests.filter((test) => test.result().state === "failed").length,
        flaky: tests.filter((test) => test.diagnostic()?.flaky).length,
      };
      appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
    }
  }
}
