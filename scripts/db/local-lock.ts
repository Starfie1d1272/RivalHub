import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const LOCK_DIRECTORY = resolve(tmpdir(), "rivalhub-local-verification.lock");
const OWNER_FILE = resolve(LOCK_DIRECTORY, "owner.json");
const POLL_INTERVAL_MS = 1_000;
const WAIT_TIMEOUT_MS = 15 * 60_000;
const MALFORMED_LOCK_STALE_MS = 5 * 60_000;

interface LockOwner {
  pid: number;
  token: string;
  command: string;
  cwd: string;
  acquiredAt: number;
}

export function acquireLocalVerificationLock(command: string): () => void {
  const owner: LockOwner = {
    pid: process.pid,
    token: randomUUID(),
    command,
    cwd: process.cwd(),
    acquiredAt: Date.now(),
  };
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  let reportedWait = false;

  for (;;) {
    try {
      mkdirSync(LOCK_DIRECTORY, { mode: 0o700 });
      try {
        writeFileSync(OWNER_FILE, JSON.stringify(owner) + "\n", {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
      } catch (error) {
        rmSync(LOCK_DIRECTORY, { recursive: true, force: true });
        throw error;
      }
      return () => releaseLocalVerificationLock(owner);
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
    }

    const observedOwner = readLockOwner();
    if (shouldReclaimLock(observedOwner)) {
      reclaimLock(observedOwner);
      continue;
    }

    if (!reportedWait) {
      const holder = observedOwner
        ? "pid " +
          String(observedOwner.pid) +
          ", command " +
          observedOwner.command +
          ", cwd " +
          observedOwner.cwd
        : "另一个 Local 验证进程";
      console.warn("Local Supabase 共享验证锁已被 " + holder + " 占用，等待其完成。");
      reportedWait = true;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        "Local Supabase 共享验证锁等待超过 15 分钟；请确认没有遗留的 Local 验证进程后再重试（锁路径：" +
          LOCK_DIRECTORY +
          "）。",
      );
    }
    sleep(POLL_INTERVAL_MS);
  }
}

function releaseLocalVerificationLock(owner: LockOwner): void {
  if (readLockOwner()?.token !== owner.token) return;
  rmSync(LOCK_DIRECTORY, { recursive: true, force: true });
}

function reclaimLock(observedOwner: LockOwner | undefined): void {
  const currentOwner = readLockOwner();
  if (observedOwner?.token !== currentOwner?.token) return;
  rmSync(LOCK_DIRECTORY, { recursive: true, force: true });
}

function readLockOwner(): LockOwner | undefined {
  try {
    const value = JSON.parse(readFileSync(OWNER_FILE, "utf8")) as Partial<LockOwner>;
    if (
      typeof value.pid !== "number" ||
      !Number.isInteger(value.pid) ||
      value.pid <= 0 ||
      typeof value.token !== "string" ||
      typeof value.command !== "string" ||
      typeof value.cwd !== "string" ||
      !Number.isFinite(value.acquiredAt)
    ) {
      return undefined;
    }
    return value as LockOwner;
  } catch {
    return undefined;
  }
}

function shouldReclaimLock(owner: LockOwner | undefined): boolean {
  if (owner) return !isProcessAlive(owner.pid);
  try {
    return Date.now() - statSync(LOCK_DIRECTORY).mtimeMs >= MALFORMED_LOCK_STALE_MS;
  } catch {
    return true;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EEXIST"
  );
}

function sleep(milliseconds: number): void {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, milliseconds);
}
