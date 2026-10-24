import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runOwnedCommand } from "../../../scripts/ci/command-watchdog.mjs";

// These subprocesses exercise actual pipe lifetime, process ownership and recovery;
// mocking spawn cannot reproduce a detached grandchild keeping stdout open.
describe("command deadline and cleanup", () => {
  it("preserves successful and failed leader exits", async () => {
    expect((await runOwnedCommand(process.execPath, ["-e", "process.exit(0)"], { timeoutMs: 2000 })).code).toBe(0);
    expect((await runOwnedCommand(process.execPath, ["-e", "process.exit(7)"], { timeoutMs: 2000 })).code).toBe(7);
  });

  it("terminates a detached stdout holder after its leader reports passing and exits zero", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ci-watchdog-"));
    const pidFile = join(dir, "pid");
    const unrelated = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
    try {
      const childCode = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`;
      const leaderCode = `const c=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{detached:true,stdio:['ignore',1,2]});c.unref();console.log('2 passed (39.2s)');process.exit(0)`;
      let evidence;
      const result = await runOwnedCommand(process.execPath, ["-e", leaderCode], { timeoutMs: 500, graceMs: 100, onTimeout: details => { evidence = details; } });
      expect(result.code).toBe(124);
      expect(result.exited).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("2 passed");
      expect(evidence.timedOut).toBe(true);
      expect(result.milliseconds).toBeLessThan(2500);
      const pid = Number(readFileSync(pidFile, "utf8"));
      // Allow the kernel to reap the killed process; no unbounded process wait.
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(() => process.kill(pid, 0)).toThrow();
      expect(() => process.kill(unrelated.pid, 0)).not.toThrow();
    } finally { unrelated.kill("SIGKILL"); rmSync(dir, { recursive: true, force: true }); }
  });

  it("still terminates the command if writing timeout evidence fails", async () => {
    const result = await runOwnedCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      timeoutMs: 100, graceMs: 50, onTimeout: () => { throw new Error("disk full"); },
    });
    expect(result.code).toBe(124);
    expect(result.cleanupError).toBe("failure_evidence_write_failed");
  });
});
