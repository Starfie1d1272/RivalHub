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
