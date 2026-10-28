import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("timing command CI boundary", () => {
  it("preserves caller GitHub credentials", () => {
    const dir = mkdtempSync(join(tmpdir(), "timing-other-workflow-"));
    try {
      const result = spawnSync(process.execPath, ["scripts/ci/timing.mjs", "release-style command", "--", process.execPath,
        "-e", "if(process.env.GH_TOKEN!=='fixture-gh'||process.env.GITHUB_TOKEN!=='fixture-github'||process.env.RIVALHUB_CI_METADATA_TOKEN)process.exit(9)"], {
        encoding: "utf8", timeout: 4000, env: { ...process.env, GITHUB_ACTIONS: "true", RIVALHUB_CI_WATCHDOG_OWNER: "0", RIVALHUB_TIMING_STDOUT_ONLY: "0", RIVALHUB_TIMING_FILE: join(dir, "timing"),
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

});
