import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { digestDbTraffic } from "@/lib/observability/db-traffic-contract";

const fault = vi.hoisted(() => ({ target: "" }));
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: async (...args: Parameters<typeof actual.open>) => {
    const handle = await actual.open(...args);
    if (fault.target && String(args[0]).endsWith(fault.target)) Object.defineProperty(handle, "sync", { value: async () => { throw new Error("simulated fsync failure"); } });
    return handle;
  } };
});

it("does not advance memory after file fsync fails and retries the same state", async () => {
  const { DbTrafficSpool } = await import("@/lib/observability/db-traffic-spool");
  const root = await mkdtemp(join(tmpdir(), "traffic-fsync-"));
  try {
    const spool = await DbTrafficSpool.open(root); const next = spool.snapshot();
    const body = { id: "same", at: 1 };
    next.batches.push({ id: body.id, body: JSON.stringify(body), digest: await digestDbTraffic(body), at: 1, attempted: false, nextAttemptAt: 1, attempts: 0 });
    fault.target = ".tmp";
    await expect(spool.commit(next)).rejects.toThrow("simulated fsync failure");
    expect(spool.snapshot().batches).toHaveLength(0);
    fault.target = ""; await spool.commit(next); spool.close();
    const restored = await DbTrafficSpool.open(root); expect(restored.snapshot().batches[0].id).toBe("same"); restored.close();
  } finally { fault.target = ""; await rm(root, { recursive: true, force: true }); }
});

it("retries the same identity if directory fsync fails after rename", async () => {
  const { DbTrafficSpool } = await import("@/lib/observability/db-traffic-spool");
  const root = await mkdtemp(join(tmpdir(), "traffic-dirsync-"));
  try {
    const spool = await DbTrafficSpool.open(root); const next = spool.snapshot();
    const body = { id: "same", at: 1 };
    next.batches.push({ id: body.id, body: JSON.stringify(body), digest: await digestDbTraffic(body), at: 1, attempted: true, nextAttemptAt: 1, attempts: 1 });
    fault.target = root;
    await expect(spool.commit(next)).rejects.toThrow("simulated fsync failure");
    expect(spool.snapshot().batches).toHaveLength(0);
    fault.target = ""; await spool.commit(next); spool.close();
    const restored = await DbTrafficSpool.open(root); expect(restored.snapshot().batches).toEqual(next.batches); restored.close();
  } finally { fault.target = ""; await rm(root, { recursive: true, force: true }); }
});
