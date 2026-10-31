import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyProcess, lockHolders } from "./release-host-readback.mjs";

test("observes a real held flock without acquiring it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "release-lock-test-")); const path = join(dir, "lock");
  const child = spawn("flock", ["-x", path, "sh", "-c", "printf ready; read value"], { stdio: ["pipe", "pipe", "pipe"] });
  try {
    await new Promise((resolve, reject) => { child.stdout.once("data", resolve); child.once("error", reject); child.once("exit", () => reject(new Error("flock exited"))); });
    assert.deepEqual(lockHolders(readFileSync("/proc/locks", "utf8"), statSync(path, { bigint: true })), { held: 1, waiting: 0 });
    assert.equal(classifyProcess("bash /root/rivalhub-release-abc/install-production.sh"), "release");
    assert.equal(classifyProcess("/usr/lib/openssh/sftp-server"), "transfer");
    assert.equal(classifyProcess("sshd: root@internal-sftp"), "transfer");
    assert.equal(classifyProcess("node server.js"), null);
  } finally { child.stdin.end("done\n"); await new Promise(resolve => child.once("exit", resolve)); rmSync(dir, { recursive: true, force: true }); }
});
