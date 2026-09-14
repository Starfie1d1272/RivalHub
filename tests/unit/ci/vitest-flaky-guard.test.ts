import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import type { TestCase, TestModule } from "vitest/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import VitestTimingReporter, { projectRecordFor, type ProjectRecord } from "../../../scripts/ci/vitest-timing-reporter";

const project = "unit-react-jsdom";
const sourceFile = resolve(process.cwd(), "tests/unit/components/identity-flow.test.tsx");
const guardPath = resolve(process.cwd(), "scripts/ci/assert-no-flaky.mjs");
const timingPath = resolve(process.cwd(), "scripts/ci/timing.mjs");
const workflowPath = resolve(process.cwd(), ".github/workflows/ci.yml");
const vitestConfigPath = resolve(process.cwd(), "vitest.config.ts");

let tempDirectory: string;
let stateFile: string;

beforeEach(() => {
  tempDirectory = mkdtempSync(join(tmpdir(), "rivalhub-vitest-flaky-"));
  stateFile = join(tempDirectory, "timing.jsonl");
  vi.stubEnv("RIVALHUB_TIMING", "1");
  vi.stubEnv("RIVALHUB_TIMING_FILE", stateFile);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(tempDirectory, { recursive: true, force: true });
});

function fakeTest(name: string, flaky: boolean, retryCount: number, state: "passed" | "failed" = "passed") {
  return {
    fullName: name,
    result: () => ({ state }),
    diagnostic: () => ({
      duration: 12,
      startTime: 0,
      retryCount,
      repeatCount: retryCount,
      flaky,
      slow: false,
      heap: undefined,
    }),
  } as unknown as TestCase;
}

function fakeModule(tests: TestCase[], moduleId = sourceFile) {
  return {
    project: { name: project },
    moduleId,
    children: { allTests: () => tests },
    diagnostic: () => ({ duration: 42 }),
  } as unknown as TestModule;
}

function writeState(records: object[]) {
  writeFileSync(stateFile, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
}

function projectState(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    kind: "vitest-project",
    project,
    files: 1,
    tests: 1,
    failed: 0,
    flaky: 0,
    flakyTests: [],
    slowFiles: [],
    ...overrides,
  };
}

function runGuard() {
  return spawnSync(process.execPath, [guardPath, "--project", project], {
    encoding: "utf8",
    env: { ...process.env, RIVALHUB_TIMING_FILE: stateFile },
  });
}

describe("Vitest flaky evidence", () => {
  it("records flaky test identity and retry count in the existing timing evidence", () => {
    const flaky = fakeTest("identity flow UI > after a successful resend", true, 1);
    const deterministicFailure = fakeTest("identity flow UI > deterministic failure", false, 1, "failed");

    new VitestTimingReporter().onTestRunEnd([fakeModule([flaky, deterministicFailure])]);

    const record = JSON.parse(readFileSync(stateFile, "utf8")) as ProjectRecord;
    expect(record).toMatchObject({
      kind: "vitest-project",
      project,
      files: 1,
      tests: 2,
      failed: 1,
      flaky: 1,
      flakyTests: [{ file: relative(process.cwd(), sourceFile), name: flaky.fullName, retryCount: 1 }],
    });
  });

  it("does not classify an ordinary failed or first-attempt-passed test as flaky", () => {
    const record = projectRecordFor(project, [fakeModule([
      fakeTest("first attempt passed", false, 0),
      fakeTest("retry also failed", false, 1, "failed"),
    ])]);

    expect(record.failed).toBe(1);
    expect(record.flaky).toBe(0);
    expect(record.flakyTests).toEqual([]);
  });

  it("emits zero-count project evidence for an affected run with no related tests", () => {
    vi.stubEnv("RIVALHUB_VITEST_PROJECT", project);

    new VitestTimingReporter().onTestRunEnd([]);

    expect(JSON.parse(readFileSync(stateFile, "utf8"))).toMatchObject({
      kind: "vitest-project",
      project,
      files: 0,
      tests: 0,
      flaky: 0,
      flakyTests: [],
    });
  });

  it("fails when retry-pass evidence is present", () => {
    writeState([projectState({
      flaky: 1,
      flakyTests: [{ file: "tests/unit/components/identity-flow.test.tsx", name: "identity flow UI > resend", retryCount: 1 }],
    })]);

    const result = runGuard();

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("first attempt failed; retry passed; gate intentionally failed");
    expect(`${result.stdout}${result.stderr}`).toContain("identity-flow.test.tsx");
  });

  it("passes deterministic and first-attempt-passed evidence", () => {
    writeState([projectState()]);

    const result = runGuard();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("has no flaky tests");
  });

  it("fails closed when the expected project evidence is absent", () => {
    writeState([projectState({ project: "unit-server-node" })]);

    const result = runGuard();

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("未找到 Vitest project evidence");
  });

  it("renders flaky identities in the GitHub Step Summary", () => {
    writeState([projectState({
      flaky: 1,
      flakyTests: [{ file: "tests/unit/components/identity-flow.test.tsx", name: "identity flow UI | resend", retryCount: 1 }],
    })]);
    const summaryFile = join(tempDirectory, "summary.md");
    const result = spawnSync(process.execPath, [timingPath, "summary"], {
      encoding: "utf8",
      env: { ...process.env, RIVALHUB_TIMING_FILE: stateFile, GITHUB_STEP_SUMMARY: summaryFile },
    });

    expect(result.status).toBe(0);
    const summary = readFileSync(summaryFile, "utf8");
    expect(summary).toContain("### Vitest flaky evidence");
    expect(summary).toContain("first attempt failed; retry passed");
    expect(summary).toContain("identity flow UI \\| resend");
  });

  it("keeps the retry and guard scoped to the React Vitest project", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const vitestConfig = readFileSync(vitestConfigPath, "utf8");

    expect(vitestConfig).toContain('const vitestCiRetry = process.env.GITHUB_ACTIONS === "true" ? 1 : 0;');
    expect(vitestConfig).toContain("pool: \"forks\"");
    expect(vitestConfig).toContain("isolate: true");
    expect(vitestConfig).toContain("retry: vitestCiRetry");
    expect(vitestConfig.match(/retry:/g)).toHaveLength(1);
    expect(workflow).toContain("RIVALHUB_VITEST_PROJECT: ${{ matrix.project || '' }}");
    expect(workflow).toContain("if: ${{ always() && matrix.project == 'unit-react-jsdom' }}");
    expect(workflow).toContain("node scripts/ci/assert-no-flaky.mjs --project unit-react-jsdom");
    expect(workflow).not.toContain("--repeats");
  });
});
