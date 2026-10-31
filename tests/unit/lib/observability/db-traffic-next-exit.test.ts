import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { DbTrafficSpool } from "@/lib/observability/db-traffic-spool";
import { DbTrafficDelivery } from "@/lib/observability/db-traffic-delivery";

it.skipIf(!existsSync(".next/BUILD_ID")).each(["network", "sync"])("restores a real Next SIGTERM while %s is blocked", async mode => {
  const root = await mkdtemp(join(tmpdir(), "traffic-next-exit-"));
  const child = spawn(process.execPath, ["--import", "tsx", "tests/fixtures/observability/db-traffic-next-exit.cjs", root, mode], { stdio: ["ignore", "pipe", "pipe"] });
  let errors = ""; child.stderr.on("data", data => { errors += String(data); });
  try {
    await new Promise<void>((resolve, reject) => {
      let output = ""; child.stdout.on("data", data => { output += String(data); if (output.includes("CAPSULE_READY")) resolve(); });
      child.once("error", reject); child.once("exit", code => reject(new Error(`Next exited ${code}: ${errors}`)));
    });
    child.kill("SIGTERM"); const code = await new Promise<number | null>(resolve => child.once("exit", resolve)); expect(code).toBe(143);
    const spool = await DbTrafficSpool.open(root);
    await new DbTrafficDelivery(spool, { process: crypto.randomUUID(), release: "new", deployment: "new" }).start(Date.now());
    const rows = spool.snapshot().batches.flatMap(item => (JSON.parse(item.body) as { rows: Array<{ rows: number }> }).rows.map(row => row.rows));
    expect(rows.sort()).toEqual([2, 3]); spool.close();
  } finally { child.kill("SIGKILL"); await rm(root, { recursive: true, force: true }); }
}, 30000);

it.skipIf(!existsSync(".next/BUILD_ID")).each(["partial", "partial-sync"])("settles a pending PostgreSQL frame before a real Next SIGTERM snapshot (%s)", async mode => {
  const root = await mkdtemp(join(tmpdir(), "traffic-next-partial-"));
  const child = spawn(process.execPath, ["--import", "tsx", "tests/fixtures/observability/db-traffic-next-exit.cjs", root, mode], { stdio: ["ignore", "pipe", "pipe"] });
  let errors = ""; child.stderr.on("data", data => { errors += String(data); });
  try {
    await new Promise<void>((resolve, reject) => {
      let output = ""; child.stdout.on("data", data => { output += String(data); if (output.includes("CAPSULE_READY")) resolve(); });
      child.once("error", reject); child.once("exit", code => reject(new Error(`Next exited ${code}: ${errors}`)));
    });
    child.kill("SIGTERM"); expect(await new Promise<number | null>(resolve => child.once("exit", resolve))).toBe(143);
    const spool = await DbTrafficSpool.open(root);
    await new DbTrafficDelivery(spool, { process: crypto.randomUUID(), release: "new", deployment: "new" }).start(Date.now());
    const batches = spool.snapshot().batches.map(item => JSON.parse(item.body));
    expect(batches).toHaveLength(mode === "partial" ? 1 : 2);
    expect(batches.find(batch => batch.receivedBytes === 3)).toMatchObject({ receivedBytes: 3, remainingRxBytes: 3, remaining: { partial: 3 } });
    const { dbTrafficQualityReasons } = await import("@/lib/observability/db-traffic-contract");
    for (const batch of batches) expect(dbTrafficQualityReasons(batch)).toEqual([]); spool.close();
  } finally { child.kill("SIGKILL"); await rm(root, { recursive: true, force: true }); }
}, 30000);
