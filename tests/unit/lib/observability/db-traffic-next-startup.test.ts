import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fork } from "node:child_process";
import { createServer } from "node:net";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

async function port(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer(); server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const address = server.address(); if (!address || typeof address === "string") return reject(new Error("missing listener")); server.close(() => resolve(address.port)); });
  });
}
function request(target: number): Promise<number> {
  return new Promise((resolve, reject) => { get({ hostname: "127.0.0.1", port: target, path: "/_next/image" }, response => { response.resume(); resolve(response.statusCode!); }).once("error", reject); });
}
function nextMessage(child: ReturnType<typeof fork>, event: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => { const onMessage = (value: Record<string, unknown>) => { if (value.event === event) { child.off("message", onMessage); resolve(value); } }; child.on("message", onMessage); child.once("error", reject); child.once("exit", code => reject(new Error(`Next exited ${code}`))); });
}

it.skipIf(!existsSync(".next/BUILD_ID"))("holds actual Next requests until the durable startup marker is committed", async () => {
  const root = await mkdtemp(join(tmpdir(), "traffic-next-marker-")); const listener = await port();
  const child = fork("tests/fixtures/observability/db-traffic-next-startup.cjs", [root, String(listener), "held"], { execArgv: ["--import", "tsx"], stdio: ["ignore", "pipe", "pipe", "ipc"] });
  try {
    await nextMessage(child, "ready"); let resolved = false;
    const response = request(listener).then(value => { resolved = true; return value; });
    await new Promise<void>((resolve, reject) => { let out = ""; child.stdout!.on("data", data => { out += String(data); if (out.includes("MARKER_WAIT")) resolve(); }); child.once("exit", code => reject(new Error(`Next exited ${code}`))); });
    await new Promise(resolve => setTimeout(resolve, 100)); expect(resolved).toBe(false);
    child.send("release"); expect(await response).toBe(400);
    const stored = JSON.parse(await readFile(join(root, "state.json"), "utf8")); expect(stored.openWindowSince).toEqual(expect.any(Number));
  } finally { child.kill("SIGTERM"); await new Promise<void>(resolve => child.once("exit", () => resolve())); await rm(root, { recursive: true, force: true }); }
}, 30000);

it.skipIf(!existsSync(".next/BUILD_ID"))("keeps actual Next available on disk failure and records unknown on recovery", async () => {
  const root = await mkdtemp(join(tmpdir(), "traffic-next-degraded-")); const spool = join(root, "blocked"); await writeFile(spool, "fixture"); const listener = await port();
  const child = fork("tests/fixtures/observability/db-traffic-next-startup.cjs", [spool, String(listener), "failure"], { execArgv: ["--import", "tsx"], stdio: ["ignore", "pipe", "pipe", "ipc"] }); let errors = "";
  child.stderr!.on("data", data => { errors += String(data); });
  try {
    await nextMessage(child, "ready"); expect(await request(listener)).toBe(400); expect(errors).toContain("db_traffic.startup_degraded");
    await rm(spool); const retried = nextMessage(child, "retried"); child.send("retry"); expect(await retried).toMatchObject({ ready: true, unknown: true });
  } finally { child.kill("SIGTERM"); await new Promise<void>(resolve => child.once("exit", () => resolve())); await rm(root, { recursive: true, force: true }); }
}, 30000);
