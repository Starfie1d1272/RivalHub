import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import type { Reporter, TestModule } from "vitest/node";

export type FlakyTestRecord = {
  file: string;
  name: string;
  retryCount: number;
};

export type ProjectRecord = {
  kind: "vitest-project";
  project: string;
  files: number;
  tests: number;
  failed: number;
  flaky: number;
  flakyTests: FlakyTestRecord[];
  slowFiles: Array<{ file: string; milliseconds: number }>;
};

function statePath(): string {
  return process.env.RIVALHUB_TIMING_FILE
    ?? resolve(process.env.RUNNER_TEMP ?? ".agent-tmp", `rivalhub-timing-${process.env.GITHUB_JOB ?? "local"}.jsonl`);
}

export function projectRecordFor(project: string, modules: ReadonlyArray<TestModule>): ProjectRecord {
  const tests = modules.flatMap((testModule) => [...testModule.children.allTests()]);
  const flakyTests = modules
    .flatMap((testModule) => {
      const file = relative(process.cwd(), testModule.moduleId);
      return [...testModule.children.allTests()].flatMap((test) => {
        const diagnostic = test.diagnostic();
        return diagnostic?.flaky
          ? [{ file, name: test.fullName, retryCount: diagnostic.retryCount }]
          : [];
      });
    })
    .sort((left, right) => left.file.localeCompare(right.file) || left.name.localeCompare(right.name));
  const slowFiles = modules
    .map((testModule) => ({
      file: relative(process.cwd(), testModule.moduleId),
      milliseconds: Math.max(0, Math.round(testModule.diagnostic().duration)),
    }))
    .sort((left, right) => right.milliseconds - left.milliseconds)
    .slice(0, 15);

  return {
    kind: "vitest-project",
    project,
    files: modules.length,
    tests: tests.length,
    failed: tests.filter((test) => test.result().state === "failed").length,
    flaky: flakyTests.length,
    flakyTests,
    slowFiles,
  };
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
    const configuredProject = process.env.RIVALHUB_VITEST_PROJECT?.trim();
    if (grouped.size === 0 && configuredProject) grouped.set(configuredProject, []);

    const path = statePath();
    mkdirSync(dirname(path), { recursive: true });
    for (const [project, modules] of grouped) {
      const record = projectRecordFor(project, modules);
      appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
    }
  }
}
