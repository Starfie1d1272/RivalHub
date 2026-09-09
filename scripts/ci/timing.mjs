import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

const env = process.env;
const stateFile = env.RIVALHUB_TIMING_FILE
  ?? resolve(env.RUNNER_TEMP ?? ".agent-tmp", `rivalhub-timing-${env.GITHUB_JOB ?? "local"}.jsonl`);

function ensureStateDirectory() {
  mkdirSync(dirname(stateFile), { recursive: true });
}

function appendRecord(record) {
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

async function runCommand(label, command, args) {
  const started = performance.now();
  let output = "";
  const child = spawn(command, args, { cwd: process.cwd(), env, stdio: ["inherit", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => {
    const text = String(chunk);
    output += text;
    process.stdout.write(text);
  });
  child.stderr.on("data", (chunk) => {
    const text = String(chunk);
    output += text;
    process.stderr.write(text);
  });
  const exitCode = await new Promise((resolveExit, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => resolveExit(code ?? (signal ? 1 : 0)));
  });
  record(label, performance.now() - started, { command, counts: parseTestCounts(output, env.RIVALHUB_TIMING_TEST_KIND) });
  for (const internal of parseTimingOutput(output)) appendRecord(internal);
  process.exitCode = exitCode;
}

function renderSummary() {
  const records = existsSync(stateFile)
    ? readFileSync(stateFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
    : [];
  const summaryPath = env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;

  const lines = [
    `## CI timing${env.GITHUB_JOB ? ` · ${env.GITHUB_JOB}` : ""}`,
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
    lines.push("", "### Vitest projects", "", "| project | wall time | files | tests | failed | flaky |", "| --- | ---: | ---: | ---: | ---: | ---: |");
    for (const item of projectRecords) {
      lines.push(`| ${item.project} | ${(item.milliseconds / 1000).toFixed(2)}s | ${item.files} | ${item.tests} | ${item.failed} | ${item.flaky} |`);
    }
  }
  appendFileSync(summaryPath, `${lines.join("\n")}\n`, "utf8");
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
} else {
  const separator = args.indexOf("--");
  if (separator < 1 || !args[separator + 1]) {
    throw new Error("用法：timing.mjs <label> -- <command> [args...]，或 timing.mjs summary。");
  }
  await runCommand(args.slice(0, separator).join(" "), args[separator + 1], args.slice(separator + 2));
}
