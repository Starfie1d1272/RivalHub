import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("timing command CI boundary", () => {
  it("keeps other workflows opt-out and preserves caller GitHub credentials", () => {
    const dir = mkdtempSync(join(tmpdir(), "timing-other-workflow-"));
    try {
      const result = spawnSync(process.execPath, ["scripts/ci/timing.mjs", "release-style command", "--", process.execPath,
        "-e", "if(process.env.GH_TOKEN!=='fixture-gh'||process.env.GITHUB_TOKEN!=='fixture-github'||process.env.RIVALHUB_CI_METADATA_TOKEN)process.exit(9)"], {
        encoding: "utf8", timeout: 4000, env: { ...process.env, GITHUB_ACTIONS: "true", RIVALHUB_CI_BUDGET_ENABLED: "0",
          RIVALHUB_CI_WATCHDOG_OWNER: "0", RIVALHUB_TIMING_STDOUT_ONLY: "0", RIVALHUB_TIMING_FILE: join(dir, "timing"),
          GH_TOKEN: "fixture-gh", GITHUB_TOKEN: "fixture-github", RIVALHUB_CI_METADATA_TOKEN: "fixture-internal" },
      });
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(join(dir, "timing"), "utf8")).not.toContain('"failure":');
    } finally { rmSync(dir, { force: true, recursive: true }); }
  });

  it("retains passing counts and a nonzero timeout instead of accepting printed success", () => {
    const dir = mkdtempSync(join(tmpdir(), "timing-timeout-"));
    try {
      const result = spawnSync(process.execPath, ["scripts/ci/timing.mjs", "body", "--timeout-ms", "150", "--", process.execPath,
        "-e", "console.log('2 passed (39.2s)');process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], {
        encoding: "utf8", timeout: 4000, env: { ...process.env, GITHUB_ACTIONS: "false", RIVALHUB_CI_WATCHDOG_OWNER: "0",
          RIVALHUB_TIMING_STDOUT_ONLY: "0", RIVALHUB_TIMING_TEST_KIND: "e2e", RIVALHUB_TIMING_FILE: join(dir, "timing") },
      });
      expect(result.status, result.stderr).toBe(124);
      const records = readFileSync(join(dir, "timing"), "utf8").trim().split("\n").map(line => JSON.parse(line));
      expect(records[0]).toMatchObject({ kind: "command-failure", timedOut: true });
      expect(records.at(-1)).toMatchObject({ kind: "timing", timedOut: true, counts: { passed: 2 } });
    } finally { rmSync(dir, { force: true, recursive: true }); }
  });

  it.each(["exhausted", "delayed"])("rejects %s metadata before launching work and persists failure", mode => {
    const dir = mkdtempSync(join(tmpdir(), "timing-active-"));
    try {
      const now = Date.now();
      const step = { name: "body", status: "in_progress", started_at: new Date(now - 190000).toISOString() };
      const plan = { name: "plan", conclusion: "success", steps: [{ started_at: new Date(now - 300000).toISOString(), completed_at: new Date(now - 299000).toISOString() }] };
      const rows = [plan, { name: "system / browser-4", steps: [step] }];
      writeFileSync(join(dir, "jobs"), rows.map(row => JSON.stringify(row)).join("\n"));
      writeFileSync(join(dir, "gh"), '#!/bin/sh\nprintf "%s\\n" "$@" > "$CI_TEST_ARGS"\nif [ "$CI_TEST_MODE" = delayed ] && [ ! -f "$CI_TEST_FIRST" ]; then touch "$CI_TEST_FIRST"; exit 0; fi\ncat "$CI_TEST_JOBS"\n');
      chmodSync(join(dir, "gh"), 0o755);
      const result = spawnSync(process.execPath, ["scripts/ci/timing.mjs", "body", "--", process.execPath, "-e",
        `require('node:fs').writeFileSync(${JSON.stringify(join(dir, "launched"))},'yes')`], { encoding: "utf8", timeout: 5000,
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GITHUB_ACTIONS: "true", RIVALHUB_CI_BUDGET_ENABLED: "1", RIVALHUB_CI_WATCHDOG_OWNER: "0",
          RIVALHUB_TIMING_STDOUT_ONLY: "0", RIVALHUB_TIMING_FILE: join(dir, "timing"),
          GITHUB_REPOSITORY: "owner/repo", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "2",
          RIVALHUB_CI_JOB_NAME: "system / browser-4", RIVALHUB_CI_STEP_NAME: "body", RIVALHUB_CI_EXECUTION_BUDGET_MS: "180000",
          CI_TEST_MODE: mode, CI_TEST_FIRST: join(dir, "first"), CI_TEST_ARGS: join(dir, "args"), CI_TEST_JOBS: join(dir, "jobs"),
        } });
      expect(result.status, result.stderr).toBe(1);
      expect(existsSync(join(dir, "launched"))).toBe(false);
      expect(readFileSync(join(dir, "timing"), "utf8")).toContain("CI execution budget exhausted before command start");
      expect(readFileSync(join(dir, "args"), "utf8")).toContain("repos/owner/repo/actions/runs/123/attempts/2/jobs?per_page=100");
    } finally { rmSync(dir, { force: true, recursive: true }); }
  });
});
