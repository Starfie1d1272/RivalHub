import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { executionBudget, jobExecutionMilliseconds } from "../../../scripts/ci/execution-budget.mjs";

const base = Date.parse("2026-10-20T00:00:00Z");
const stamp = milliseconds => new Date(base + milliseconds).toISOString();
const step = (start, duration) => ({ started_at: stamp(start), completed_at: stamp(start + duration), conclusion: "success" });
const job = (name, duration, start = 0) => ({ name, started_at: stamp(-3_600_000), conclusion: "success", steps: [step(start, duration)] });
const options = { requiredJobs: ["static", "postgres"], requireReview: true, gateMilliseconds: 5_000 };
const corpus = () => [job("plan", 10_000), job("static / types", 30_000, 3_600_000), job("static / unit", 20_000, 7_200_000),
  job("postgres / 1/2", 40_000, 10_800_000), job("postgres / 2/2", 15_000, 14_400_000),
  job("dependency-graph-build", 60_000), job("dependency-review", 5_000),
  { name: "system / skipped", conclusion: "skipped" }, { name: "ci-gate", steps: [] }];

describe("CI execution budget", () => {
  it("excludes initial/inter-job queues and takes the longest parallel branch", () => {
    // Several hours of scheduling gaps and two PG shards still have a 65s execution critical path.
    expect(executionBudget(corpus(), options).executionMilliseconds).toBe(65_000);
    const shifted = corpus().map(row => ({ ...row, steps: row.steps?.map(s => ({ ...s,
      started_at: stamp(Date.parse(s.started_at) - base + 86_400_000),
      completed_at: stamp(Date.parse(s.completed_at) - base + 86_400_000),
    })) }));
    expect(executionBudget(shifted, options).executionMilliseconds).toBe(65_000);
  });

  it("adds serial planner/worker/gate work rather than granting every job its own 3 minutes", () => {
    const rows = corpus(); rows[0] = job("plan", 70_000); rows[3] = job("postgres / 1/2", 120_000);
    expect(executionBudget(rows, options).executionMilliseconds).toBe(195_000);
  });

  it("counts setup, install, tests and cleanup, excluding gaps and overlapping timestamps", () => {
    expect(jobExecutionMilliseconds({ name: "worker", steps: [step(0, 5_000), step(20_000, 10_000),
      step(29_000, 20_000), step(60_000, 4_000), { conclusion: "skipped" }] })).toBe(38_000);
  });

  it("accepts optional skipped lanes and dependency review outside a PR", () => {
    const rows = corpus().filter(row => !row.name.startsWith("postgres / ") && row.name !== "dependency-review");
    expect(executionBudget(rows, { ...options, requiredJobs: ["static"], requireReview: false }).executionMilliseconds).toBe(65_000);
  });

  it("fails closed for missing required lanes, missing review, unknown jobs and incomplete timestamps", () => {
    expect(() => executionBudget(corpus().filter(row => !row.name.startsWith("postgres / ")), options)).toThrow(/Missing/);
    expect(() => executionBudget(corpus().filter(row => row.name !== "dependency-review"), options)).toThrow(/Missing/);
    expect(() => executionBudget([...corpus(), job("new-capability", 1)], options)).toThrow(/Unknown/);
    expect(() => executionBudget([...corpus(), { name: "static / missing", steps: [] }], options)).toThrow(/Missing/);
    expect(() => jobExecutionMilliseconds({ name: "static / incomplete", steps: [{ started_at: stamp(0), completed_at: null }] })).toThrow(/Incomplete/);
    expect(() => jobExecutionMilliseconds({ name: "static / reversed", steps: [{ started_at: stamp(1), completed_at: stamp(0) }] })).toThrow(/Incomplete/);
  });

  it("enforces the exact 180s CLI boundary and retains timing evidence when over budget", () => {
    const dir = mkdtempSync(join(tmpdir(), "ci-budget-"));
    try {
      const path = join(dir, "jobs.json");
      const rows = [job("plan", 10_000), job("static / unit", 168_000), job("dependency-graph-build", 1)];
      writeFileSync(path, rows.map(row => JSON.stringify(row)).join("\n"));
      const run = gate => spawnSync(process.execPath, ["scripts/ci/execution-budget.mjs", "--jobs", path,
        "--gate-ms", String(gate), "--budget-ms", "180000"], { encoding: "utf8",
        env: { ...process.env, RIVALHUB_TIMING_STDOUT_ONLY: "0", REQUIRED_JOBS: '["static"]', GITHUB_EVENT_NAME: "push", RIVALHUB_TIMING_FILE: join(dir, "timing.jsonl") } });
      expect(run(2_000).status).toBe(0);
      expect(run(2_001).status).toBe(1);
      expect(readFileSync(join(dir, "timing.jsonl"), "utf8")).toContain('"milliseconds":180001');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it.each([
    ["ready", 0, 0, 1], ["missing", 1, 0, 1], ["over-budget", 0, 0, 1],
    ["wall-api-failure", 0, 0, 1], ["jobs-api-failure", 0, 0, 1],
  ])("reports the exact attempt without blocking on timing: %s", (mode, missingReads, exitCode, reads) => {
    const workflow = parse(readFileSync(resolve(".github/workflows/ci.yml"), "utf8"));
    const record = workflow.jobs.gate.steps.find(s => s.name === "Record required gate wall time").run;
    const enforce = workflow.jobs.gate.steps.find(s => s.name === "Report required gate execution budget").run;
    const command = `${record}\nset -a\nsource "$GITHUB_ENV"\nset +a\n${enforce}`;
    const dir = mkdtempSync(join(tmpdir(), "ci-budget-workflow-"));
    try {
      const clock = join(dir, "clock"); writeFileSync(clock, "1000");
      const rows = corpus();
      if (mode === "over-budget") rows[0] = job("plan", 200_000);
      writeFileSync(join(dir, "jobs.json"), rows.map(row => JSON.stringify(row)).join("\n"));
      writeFileSync(join(dir, "reads"), "0");
      // The metadata fetch consumes 10 minutes of external waiting on a fake clock.
      writeFileSync(join(dir, "date"), '#!/bin/sh\ncat "$CI_TEST_CLOCK"\n');
      writeFileSync(join(dir, "gh"), `#!/bin/sh
printf '%s\\n' "$@" >> "$CI_TEST_ARGS"
printf 601000 > "$CI_TEST_CLOCK"
case "$*" in
  *jobs*)
    count=$(cat "$CI_TEST_READS")
    count=$((count + 1))
    printf '%s' "$count" > "$CI_TEST_READS"
    if [ "$CI_TEST_MODE" = jobs-api-failure ]; then exit 1; fi
    if [ "$count" -le "$CI_TEST_MISSING_READS" ]; then printf '{"name":"plan","steps":[]}\\n'; else cat "$CI_TEST_JOBS"; fi
    ;;
  *) if [ "$CI_TEST_MODE" = wall-api-failure ]; then exit 1; fi; printf '1970-01-01T00:00:00Z';;
esac
`);
      writeFileSync(join(dir, "sleep"), '#!/bin/sh\nexit 0\n');
      chmodSync(join(dir, "sleep"), 0o755);
      chmodSync(join(dir, "date"), 0o755); chmodSync(join(dir, "gh"), 0o755);
      const result = spawnSync("bash", ["-e", "-c", command], { encoding: "utf8", env: { ...process.env,
        PATH: `${dir}:${process.env.PATH}`, RUNNER_TEMP: dir, GITHUB_ENV: join(dir, "github-env"), RIVALHUB_GATE_STARTED_MS: "0",
        GITHUB_STEP_SUMMARY: join(dir, "summary"), GITHUB_REPOSITORY: "owner/repo", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "2", GITHUB_EVENT_NAME: "pull_request",
        REQUIRED_JOBS: '["static","postgres"]', RIVALHUB_TIMING_STDOUT_ONLY: "0", RIVALHUB_TIMING_FILE: join(dir, "timing.jsonl"),
        CI_TEST_MODE: mode, CI_TEST_CLOCK: clock, CI_TEST_ARGS: join(dir, "args"), CI_TEST_JOBS: join(dir, "jobs.json"),
        CI_TEST_READS: join(dir, "reads"), CI_TEST_MISSING_READS: String(missingReads),
      } });
      expect(result.status, result.stderr).toBe(exitCode);
      expect(Number(readFileSync(join(dir, "reads"), "utf8"))).toBe(reads);
      expect(readFileSync(join(dir, "args"), "utf8")).toContain('repos/owner/repo/actions/runs/123/attempts/2/jobs?per_page=100');
      expect(readFileSync(join(dir, "args"), "utf8")).toContain('--paginate');
      if (!["missing", "jobs-api-failure"].includes(mode)) expect(readFileSync(join(dir, "timing.jsonl"), "utf8")).toContain('"label":"required gate execution critical path"');
      if (mode !== "ready") expect(readFileSync(join(dir, "summary"), "utf8")).toContain(mode === "over-budget" ? "exceeded" : "unavailable");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
