import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const MARKER = "RIVALHUB_CI_COMMAND_TOKEN";

function ownedProcesses(token) {
  const needle = `${MARKER}=${token}`;
  if (process.platform === "linux") return readdirSync("/proc").filter(pid => /^\d+$/.test(pid)).flatMap(pid => {
    try { return readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").includes(needle) ? [Number(pid)] : []; }
    catch { return []; } // Processes can exit between enumeration and reading.
  });
  if (process.platform === "darwin") {
    const result = spawnSync("ps", ["eww", "-axo", "pid=,command="], { encoding: "utf8", timeout: 1000, maxBuffer: 8 * 1024 * 1024 });
    if (result.error || result.status !== 0) throw new Error("Cannot enumerate owned command processes");
    return result.stdout.split("\n").flatMap(line => line.split(/\s+/).includes(needle) ? [Number(line.trim().split(/\s+/)[0])] : []);
  }
  throw new Error("Command watchdog requires Linux or macOS process ownership inspection");
}

function signalOwned(token, child, signal) {
  let pids = []; let failure;
  try { pids = ownedProcesses(token).filter(pid => pid !== process.pid); } catch (error) { failure = error; }
  for (const pid of pids) {
    try { process.kill(pid, signal); } catch (error) { if (error.code !== "ESRCH") failure ??= error; }
  }
  // Group cleanup remains available even if ownership enumeration fails.
  if (child.pid) try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== "ESRCH") failure ??= error; }
  if (failure) throw failure;
  return pids.length;
}

/** A zero leader exit is insufficient: inherited stdout can outlive it. */
export async function runOwnedCommand(command, args, { timeoutMs, graceMs = 2000, env = process.env, ownershipToken, onOutput = () => {}, onTimeout = () => {} } = {}) {
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) throw new Error("Invalid command deadline");
  const token = ownershipToken ?? randomUUID();
  const childEnv = { ...env, [MARKER]: token, RIVALHUB_CI_WATCHDOG_OWNER: "1", RIVALHUB_TIMING_STDOUT_ONLY: "1" };
  delete childEnv.RIVALHUB_CI_METADATA_TOKEN;
  const started = performance.now();
  const child = spawn(command, args, { cwd: process.cwd(), env: childEnv, detached: process.platform !== "win32", stdio: ["inherit", "pipe", "pipe"] });
  let exitCode = null; let exitSignal = null; let exited = false; let closed = false;
  let timedOut = false; let cancelled = null; let cleanupError = null; let spawnedError = null;
  const chunks = [];
  for (const [stream, target] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) stream.on("data", chunk => {
    chunks.push(String(chunk)); target.write(chunk); onOutput(String(chunk));
  });
  const result = await new Promise(resolve => {
    let deadline; let escalation; let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true; clearTimeout(deadline); clearTimeout(escalation);
      process.off("SIGINT", interrupt); process.off("SIGTERM", terminate);
      resolve({ code: timedOut ? 124 : cancelled ? (cancelled === "SIGINT" ? 130 : 143) : spawnedError || cleanupError ? 1 : exitCode ?? 1,
        exitCode, exitSignal, exited, closed, timedOut, cancelled, cleanupError, spawnError: spawnedError,
        milliseconds: performance.now() - started, output: chunks.join("") });
    };
    const stop = signal => {
      if (timedOut || cancelled || settled) return;
      if (signal) cancelled = signal; else timedOut = true;
      // Persist the failure before attempting process or stream cleanup.
      try { onTimeout({ timedOut, cancelled, exitCode, exitSignal, exited, closed, milliseconds: performance.now() - started }); }
      catch { cleanupError = "failure_evidence_write_failed"; }
      try { signalOwned(token, child, "SIGTERM"); } catch { cleanupError = "owned_process_signal_failed"; }
      escalation = setTimeout(() => {
        try { signalOwned(token, child, "SIGKILL"); } catch { cleanupError = "owned_process_kill_failed"; }
        child.stdout.destroy(); child.stderr.destroy(); child.unref();
        finish();
      }, graceMs);
    };
    const interrupt = () => stop("SIGINT");
    const terminate = () => stop("SIGTERM");
    process.on("SIGINT", interrupt); process.on("SIGTERM", terminate);
    child.once("error", () => { spawnedError = "command_spawn_failed"; finish(); });
    child.once("exit", (code, signal) => { exited = true; exitCode = code; exitSignal = signal; });
    child.once("close", (code, signal) => {
      closed = true; exitCode = code; exitSignal = signal;
      if (timedOut || cancelled) {
        // A detached child may have redirected stdio; still clean its marker.
        try { signalOwned(token, child, "SIGKILL"); } catch { cleanupError = "owned_process_kill_failed"; }
      }
      finish();
    });
    if (timeoutMs !== undefined) deadline = setTimeout(() => stop(null), timeoutMs);
  });
  return result;
}
