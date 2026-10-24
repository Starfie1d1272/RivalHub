import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { runOwnedCommand } from "./command-watchdog.mjs";
import { remainingExecutionBudget } from "./execution-budget.mjs";
import { performance } from "node:perf_hooks";

const env = process.env;
const stateFile = env.RIVALHUB_TIMING_FILE
  ?? resolve(env.RUNNER_TEMP ?? ".agent-tmp", `rivalhub-timing-${env.GITHUB_JOB ?? "local"}.jsonl`);

function ensureStateDirectory() {
  mkdirSync(dirname(stateFile), { recursive: true });
}

function appendRecord(record) {
  // The outer wrapper captures nested timing stdout and owns persistence.
  // Otherwise inner wrappers write each metric before the outer parser repeats it.
  if (env.RIVALHUB_TIMING_STDOUT_ONLY === "1") return;
  ensureStateDirectory();
  appendFileSync(stateFile, `${JSON.stringify(record)}\n`, "utf8");
}

function record(label, milliseconds, details = {}) {
  const rounded = Math.max(0, Math.round(milliseconds));
  console.log(`timing ${label}: ${rounded}ms`);
  appendRecord({ kind: "timing", label, milliseconds: rounded, ...details });
}

function parseFlag(args, name) {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error(`缺少 ${name} 参数。`);
  return args[index + 1];
}

function parseTimingOutput(output) {
  const records = [];
  const pattern = /^timing ([^:]+): (\d+)ms$/gm;
  for (const match of output.matchAll(pattern)) {
    records.push({ label: match[1], milliseconds: Number(match[2]), kind: "timing" });
  }
  return records;
}

function parseTestCounts(output, kind) {
  const counts = {};
  if (kind === "e2e") {
    for (const [label, pattern] of [["passed", /(\d+) passed/g], ["failed", /(\d+) failed/g], ["skipped", /(\d+) skipped/g], ["flaky", /(\d+) flaky/g]]) {
      counts[label] = [...output.matchAll(pattern)].at(-1)?.[1] ? Number([...output.matchAll(pattern)].at(-1)[1]) : 0;
    }
  } else {
    const files = output.match(/Test Files\s+([\d,]+)/)?.[1];
    const tests = output.match(/Tests\s+([\d,]+)/)?.[1];
    if (files) counts.files = Number(files.replaceAll(",", ""));
    if (tests) counts.tests = Number(tests.replaceAll(",", ""));
  }
  return counts;
}

function activeCommandBudget() {
  const route = `repos/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT}/jobs?per_page=100`;
  const result = spawnSync("gh", ["api", "--paginate", "-H", "Cache-Control: no-cache", route,
    "--jq", ".jobs[] | {name,conclusion,steps} | tojson"], { encoding: "utf8", env: { ...env, GH_TOKEN: env.RIVALHUB_CI_METADATA_TOKEN }, timeout: 5000, killSignal: "SIGKILL", maxBuffer: 5 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error("CI execution metadata unavailable");
  const jobs = result.stdout.split("\n").filter(Boolean).map(line => JSON.parse(line));
  return remainingExecutionBudget(jobs, { jobName: env.RIVALHUB_CI_JOB_NAME, stepName: env.RIVALHUB_CI_STEP_NAME,
    now: Date.now(), budgetMilliseconds: Number(env.RIVALHUB_CI_EXECUTION_BUDGET_MS) });
}

async function runCommand(label, command, args, { cleanup = false, timeoutMs } = {}) {
  const started = performance.now();
  let budget;
  try {
    if (env.GITHUB_ACTIONS === "true" && env.RIVALHUB_CI_BUDGET_ENABLED === "1" && env.RIVALHUB_CI_WATCHDOG_OWNER !== "1" && !cleanup) {
      budget = activeCommandBudget();
      if (budget.remainingMilliseconds <= 0) throw new Error("CI execution budget exhausted before command start");
      timeoutMs = Math.min(timeoutMs ?? Infinity, budget.remainingMilliseconds);
    }
    const result = await runOwnedCommand(command, args, { timeoutMs,
      ownershipToken: env.RIVALHUB_CI_WATCHDOG_OWNER === "1" ? env.RIVALHUB_CI_COMMAND_TOKEN : undefined,
      onTimeout: details => appendRecord({ kind: "command-failure", label, command, ...details, budget }),
    });
    record(label, performance.now() - started, { command, counts: parseTestCounts(result.output, env.RIVALHUB_TIMING_TEST_KIND),
      exitCode: result.exitCode, exitSignal: result.exitSignal, timedOut: result.timedOut, cancelled: result.cancelled,
      stdioClosed: result.closed, cleanupError: result.cleanupError, spawnError: result.spawnError, budget });
    for (const internal of parseTimingOutput(result.output)) appendRecord(internal);
    process.exitCode = result.code;
  } catch (error) {
    record(label, performance.now() - started, { command, failure: error.message, budget });
    console.error(error.message);
    process.exitCode = 1;
  }
}

function renderSummary() {
  const records = existsSync(stateFile)
    ? readFileSync(stateFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
    : [];
  const summaryPath = env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;

  const heading = env.RIVALHUB_TIMING_TITLE ?? `CI timing${env.GITHUB_JOB ? ` · ${env.GITHUB_JOB}` : ""}`;
  const lines = [
    `## ${heading}`,
    "",
    "| metric | wall time | evidence |",
    "| --- | ---: | --- |",
  ];
  for (const item of records.filter((entry) => entry.kind === "timing")) {
    const evidence = item.counts?.tests
      ? `tests=${item.counts.tests}${item.counts.files ? `, files=${item.counts.files}` : ""}`
      : item.counts?.passed !== undefined
        ? `passed=${item.counts.passed}, failed=${item.counts.failed ?? 0}, skipped=${item.counts.skipped ?? 0}, flaky=${item.counts.flaky ?? 0}`
        : "";
    lines.push(`| ${item.label} | ${(item.milliseconds / 1000).toFixed(2)}s | ${evidence} |`);
  }
  const projectRecords = records.filter((entry) => entry.kind === "vitest-project");
  if (projectRecords.length > 0) {
    lines.push("", "### Vitest project facts", "", "| project | files | tests | failed | flaky |", "| --- | ---: | ---: | ---: | ---: |");
    for (const item of projectRecords) {
      lines.push(`| ${item.project} | ${item.files} | ${item.tests} | ${item.failed} | ${item.flaky} |`);
    }
    const flakyTests = projectRecords.flatMap((item) => (item.flakyTests ?? []).map((test) => ({ project: item.project, ...test })));
    if (flakyTests.length > 0) {
      lines.push(
        "",
        "### Vitest flaky evidence",
        "",
        "first attempt failed; retry passed; retry evidence is diagnostic only; the strict flaky guard intentionally fails this static task.",
        "",
        "| project | file | full test name | first attempt | retry | retry count |",
        "| --- | --- | --- | --- | --- | ---: |",
      );
      for (const test of flakyTests) {
        lines.push(`| ${escapeSummaryCell(test.project)} | ${escapeSummaryCell(test.file)} | ${escapeSummaryCell(test.name)} | failed | passed | ${test.retryCount} |`);
      }
    }
    const slowFiles = projectRecords
      .flatMap((item) => (item.slowFiles ?? []).map((file) => ({ project: item.project, ...file })))
      .sort((left, right) => right.milliseconds - left.milliseconds)
      .slice(0, 15);
    if (slowFiles.length > 0) {
      lines.push(
        "",
        "### Slowest Vitest files",
        "",
        "Per-file diagnostic duration; this is not the project wall time.",
        "",
        "| project | file | diagnostic duration |",
        "| --- | --- | ---: |",
      );
      for (const file of slowFiles) {
        lines.push(`| ${file.project} | ${file.file} | ${(file.milliseconds / 1000).toFixed(2)}s |`);
      }
    }
  }
  appendFileSync(summaryPath, `${lines.join("\n")}\n`, "utf8");
}

function escapeSummaryCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", "<br>");
}

const args = process.argv.slice(2);
if (args[0] === "summary") {
  renderSummary();
} else if (args[0] === "record") {
  const label = parseFlag(args, "--label");
  const start = args.includes("--start-iso")
    ? Date.parse(parseFlag(args, "--start-iso"))
    : Number(parseFlag(args, "--start-ms"));
  const end = args.includes("--end-ms") ? Number(parseFlag(args, "--end-ms")) : Date.now();
  const hasValidStart = Number.isFinite(start) && Number.isFinite(end);
  record(label, hasValidStart ? end - start : 0, hasValidStart ? {} : { unavailableStart: true });
  if (args.includes("--budget-ms")) {
    const budget = Number(parseFlag(args, "--budget-ms"));
    if (!Number.isFinite(budget) || budget <= 0 || !hasValidStart || end < start) {
      throw new Error("Wall-time budget requires a valid start, end and positive budget.");
    }
    if (end - start > budget) {
      throw new Error(`Required evidence exceeded wall-time budget: ${Math.round(end - start)}ms > ${budget}ms.`);
    }
  }
} else {
  const separator = args.indexOf("--");
  if (separator < 1 || !args[separator + 1]) {
    throw new Error("用法：timing.mjs <label> -- <command> [args...]，或 timing.mjs summary。");
  }
  const labels = args.slice(0, separator);
  const cleanup = labels.includes("--cleanup");
  const timeoutIndex = labels.indexOf("--timeout-ms");
  const timeoutMs = timeoutIndex >= 0 ? Number(labels[timeoutIndex + 1]) : cleanup ? 15000 : undefined;
  if (timeoutIndex >= 0) labels.splice(timeoutIndex, 2);
  const cleanupIndex = labels.indexOf("--cleanup");
  if (cleanupIndex >= 0) labels.splice(cleanupIndex, 1);
  await runCommand(labels.join(" "), args[separator + 1], args.slice(separator + 2), { cleanup, timeoutMs });
}
