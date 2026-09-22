import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function timingStatePath(env = process.env) {
  return env.RIVALHUB_TIMING_FILE
    ?? resolve(env.RUNNER_TEMP ?? ".agent-tmp", `rivalhub-timing-${env.GITHUB_JOB ?? "local"}.jsonl`);
}

export function readProjectRecords(filePath, project) {
  if (!existsSync(filePath)) return [];

  return readFileSync(filePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Vitest timing evidence 第 ${index + 1} 行不是有效 JSON：${error instanceof Error ? error.message : String(error)}`);
      }
    })
    .filter((record) => record?.kind === "vitest-project" && record.project === project);
}

export function flakyTestsFor(records) {
  const flakyTests = [];
  for (const record of records) {
    if (!Array.isArray(record.flakyTests)) {
      throw new Error(`Vitest project ${record.project} 缺少 flakyTests evidence。`);
    }
    if (record.flaky !== record.flakyTests.length) {
      throw new Error(`Vitest project ${record.project} 的 flaky count 与 test identity 不一致。`);
    }
    flakyTests.push(...record.flakyTests);
  }
  return flakyTests;
}

export function formatFlakyFailure(project, flakyTests) {
  const lines = [
    `Vitest flaky guard failed: ${flakyTests.length} flaky test(s) in ${project}.`,
    "Retry is diagnostic evidence; first attempt failed; retry passed; gate intentionally failed.",
  ];
  for (const test of flakyTests) {
    lines.push(`- ${display(test.file)} > ${display(test.name)} (retry count: ${test.retryCount})`);
  }
  return lines.join("\n");
}

export function assertNoFlakyEvidence(filePath, project) {
  const records = readProjectRecords(filePath, project);
  if (records.length === 0) {
    throw new Error(`未找到 Vitest project evidence：${project}。`);
  }
  const flakyTests = flakyTestsFor(records);
  return { project, flakyTests };
}

function display(value) {
  return String(value).replaceAll("\n", "\\n");
}

function parseFlag(args, name) {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error(`缺少 ${name} 参数。`);
  return args[index + 1];
}

function main() {
  const args = process.argv.slice(2);
  const project = args.includes("--project")
    ? parseFlag(args, "--project")
    : process.env.RIVALHUB_VITEST_PROJECT?.trim();
  if (!project) throw new Error("需要 --project 或 RIVALHUB_VITEST_PROJECT。");

  const { flakyTests } = assertNoFlakyEvidence(timingStatePath(), project);
  if (flakyTests.length > 0) {
    console.error(formatFlakyFailure(project, flakyTests));
    process.exitCode = 1;
    return;
  }
  console.log(`Vitest flaky guard passed: ${project} has no flaky tests.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`Vitest flaky guard failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
