import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it.each([0, 7])("persists nested command timings once and preserves exit %s", (status) => {
  const directory = mkdtempSync(join(tmpdir(), "ci-nested-timing-"));
  const state = join(directory, "timing.jsonl");
  const summary = join(directory, "summary.md");
  const env = { ...process.env, RIVALHUB_TIMING_FILE: state, GITHUB_STEP_SUMMARY: summary };
  try {
    const result = spawnSync(process.execPath, ["scripts/ci/timing.mjs", "static/checks", "--",
      process.execPath, "scripts/ci/timing.mjs", "static/type-app", "--", process.execPath, "-e",
      `console.log('timing compiler: 12ms'); process.exit(${status})`], { encoding: "utf8", env });
    expect(result.status).toBe(status);
    const records = readFileSync(state, "utf8").trim().split("\n").map(line => JSON.parse(line));
    expect(records.map(record => record.label).sort()).toEqual(["compiler", "static/checks", "static/type-app"]);
    expect(records.find(record => record.label === "compiler").milliseconds).toBe(12);
    const outer = records.find(record => record.label === "static/checks").milliseconds;
    expect(outer).toBeGreaterThanOrEqual(records.find(record => record.label === "static/type-app").milliseconds);
    expect(outer).toBeGreaterThan(0);
    expect(spawnSync(process.execPath, ["scripts/ci/timing.mjs", "summary"], { env }).status).toBe(0);
    const rendered = readFileSync(summary, "utf8");
    for (const record of records) expect(rendered.split(`| ${record.label} |`)).toHaveLength(2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// A missing timestamp must not masquerade as a zero-second successful gate.
it.each([
  ["1000", "181000", 0],
  ["1000", "181001", 1],
  ["invalid", "181000", 1],
  ["181000", "1000", 1],
])("checks the complete interval %s → %s", (start, end, status) => {
  const directory = mkdtempSync(join(tmpdir(), "ci-budget-"));
  try {
    const result = spawnSync(process.execPath, ["scripts/ci/timing.mjs", "record", "--label", "gate", "--start-ms", start, "--end-ms", end, "--budget-ms", "180000"], {
      encoding: "utf8", env: { ...process.env, RIVALHUB_TIMING_FILE: join(directory, "timing.jsonl") },
    });
    expect(result.status).toBe(status);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
