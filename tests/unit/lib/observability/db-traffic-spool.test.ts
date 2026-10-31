import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { DbTrafficSpool } from "@/lib/observability/db-traffic-spool";
import { digestDbTraffic } from "@/lib/observability/db-traffic-contract";

it("restores the sealed identity and attempted state and refuses corrupt state", async () => {
  const root = await mkdtemp(join(tmpdir(), "traffic-spool-"));
  try {
    const spool = await DbTrafficSpool.open(root);
    const state = spool.snapshot();
    const body = { id: "test", at: 1 };
    state.batches.push({ id: body.id, body: JSON.stringify(body), digest: await digestDbTraffic(body), at: 1, attempted: true, nextAttemptAt: 2, attempts: 1 });
    await spool.commit(state);
    spool.close();
    const restored = await DbTrafficSpool.open(root);
    expect(restored.snapshot()).toEqual(state); restored.close();
    await writeFile(join(root, "state.json"), "{broken");
    await expect(DbTrafficSpool.open(root)).rejects.toThrow();
    expect(await readFile(join(root, "state.json"), "utf8")).toBe("{broken");
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("persists attempted identity across a lost acknowledgement and drains after restart", async () => {
  const { DbTrafficDelivery } = await import("@/lib/observability/db-traffic-delivery");
  const root = await mkdtemp(join(tmpdir(), "traffic-delivery-"));
  const identity = { process: crypto.randomUUID(), release: "v1", deployment: "d1" };
  let now = 1_800_000_000_000;
  try {
    let spool = await DbTrafficSpool.open(root);
    let delivery = new DbTrafficDelivery(spool, identity);
    await delivery.start(now);
    const batch = { id: crypto.randomUUID(), ...identity, at: now, receivedBytes: 12 };
    await delivery.seal(JSON.stringify(batch), now);
    await delivery.drain(async () => ({ ok: false, status: null, retryAfter: null, limit: null }), () => now);
    expect(spool.snapshot().batches[0]).toMatchObject({ id: batch.id, attempted: true, attempts: 1 });
    spool.close(); spool = await DbTrafficSpool.open(root); delivery = new DbTrafficDelivery(spool, identity);
    now += 600000;
    const sent: string[] = [];
    await delivery.drain(async item => { sent.push(item.id); return { ok: true, status: 200, retryAfter: null, limit: null }; }, () => now);
    expect(sent).toEqual([batch.id]);
    spool.close(); const finalSpool = await DbTrafficSpool.open(root);
    expect(finalSpool.snapshot().batches).toHaveLength(0); finalSpool.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("evicts an unsent oldest batch and commits its loss evidence with the replacement", async () => {
  const { DbTrafficDelivery } = await import("@/lib/observability/db-traffic-delivery");
  const root = await mkdtemp(join(tmpdir(), "traffic-capacity-"));
  const identity = { process: crypto.randomUUID(), release: "v1", deployment: "d1" };
  const now = 1_800_000_000_000;
  try {
    const spool = await DbTrafficSpool.open(root); const state = spool.snapshot();
    for (let i = 0; i < 256; i++) { const body = { id: crypto.randomUUID(), ...identity, at: now + i, receivedBytes: 1 }; state.batches.push({ id: body.id, body: JSON.stringify(body), digest: await digestDbTraffic(body), at: body.at, attempted: false, nextAttemptAt: now, attempts: 0 }); }
    const evicted = state.batches[0].id;
    await spool.commit(state);
    const delivery = new DbTrafficDelivery(spool, identity);
    await delivery.seal(JSON.stringify({ id: crypto.randomUUID(), ...identity, at: now + 256, receivedBytes: 2 }), now + 256);
    await delivery.seal(JSON.stringify({ id: crypto.randomUUID(), ...identity, at: now + 257, receivedBytes: 2 }), now + 257);
    spool.close(); const reopened = await DbTrafficSpool.open(root); const restored = reopened.snapshot(); reopened.close();
    expect(restored.batches).toHaveLength(256);
    expect(restored.batches.some(item => item.id === evicted)).toBe(false);
    expect(JSON.parse(restored.gaps[0].body)).toMatchObject({ reason: "overflow", certainty: "lost", batches: 2, receivedBytes: 2 });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("keeps the old committed state when a later file commit fails", async () => {
  const { chmod } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "traffic-write-failure-"));
  try {
    const spool = await DbTrafficSpool.open(root); const state = spool.snapshot();
    state.openWindowSince = 100; await spool.commit(state);
    const next = spool.snapshot(); next.openWindowSince = 200;
    await chmod(root, 0o500);
    await expect(spool.commit(next)).rejects.toThrow();
    await chmod(root, 0o700);
    spool.close(); const reopened = await DbTrafficSpool.open(root);
    expect(reopened.snapshot().openWindowSince).toBe(100); reopened.close();
  } finally { await chmod(root, 0o700); await rm(root, { recursive: true, force: true }); }
});

it("restores an attempted batch after the owner process is killed", async () => {
  const { spawn } = await import("node:child_process");
  const root = await mkdtemp(join(tmpdir(), "traffic-sigkill-"));
  const script = `const { DbTrafficSpool } = require('./src/lib/observability/db-traffic-spool.ts');
    (async () => { const spool = await DbTrafficSpool.open(process.argv[1]); const state = spool.snapshot();
    const { digestDbTraffic } = require('./src/lib/observability/db-traffic-contract.ts'); const body = { id: 'retained', at: 1 };
    state.batches.push({ id: body.id, body: JSON.stringify(body), digest: await digestDbTraffic(body), at: 1, attempted: true, nextAttemptAt: 2, attempts: 1 });
    await spool.commit(state); process.stdout.write('ready\\n'); setInterval(() => {}, 1000); })().catch(error => { console.error(error); process.exit(1); });`;
  const child = spawn(process.execPath, ["--import", "tsx", "-e", script, root], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise<void>((resolve, reject) => { child.stdout.once("data", () => resolve()); child.once("error", reject); child.once("exit", code => reject(new Error(`child exited ${code}`))); });
    child.kill("SIGKILL");
    await new Promise<void>(resolve => child.once("exit", () => resolve()));
    const reopened = await DbTrafficSpool.open(root);
    expect(reopened.snapshot().batches[0]).toMatchObject({ id: "retained", attempted: true }); reopened.close();
  } finally { child.kill("SIGKILL"); await rm(root, { recursive: true, force: true }); }
}, 10000);

it("excludes a second owner until the first releases its lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "traffic-owner-"));
  try {
    const first = await DbTrafficSpool.open(root);
    await expect(DbTrafficSpool.open(root)).rejects.toThrow();
    first.close(); const second = await DbTrafficSpool.open(root); second.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("keeps the earliest unknown coverage marker when diagnostic capacity is exhausted", async () => {
  const { DbTrafficDelivery } = await import("@/lib/observability/db-traffic-delivery");
  const root = await mkdtemp(join(tmpdir(), "traffic-gap-full-"));
  const identity = { process: crypto.randomUUID(), release: "v1", deployment: "d1" }; const now = 1_800_000_000_000;
  try {
    const spool = await DbTrafficSpool.open(root); const state = spool.snapshot();
    for (let i = 0; i < 32; i++) { const value = { id: crypto.randomUUID(), reportedAt: now, reason: "overflow" }; state.gaps.push({ id: value.id, body: JSON.stringify(value), digest: await digestDbTraffic(value), at: now, attempted: true, nextAttemptAt: now + 10000, attempts: 1 }); }
    for (let i = 0; i < 256; i++) { const value = { id: crypto.randomUUID(), ...identity, at: now + i, receivedBytes: 1 }; state.batches.push({ id: value.id, body: JSON.stringify(value), digest: await digestDbTraffic(value), at: value.at, attempted: false, nextAttemptAt: now, attempts: 0 }); }
    await spool.commit(state); const delivery = new DbTrafficDelivery(spool, identity);
    await delivery.seal(JSON.stringify({ id: crypto.randomUUID(), ...identity, at: now + 256, receivedBytes: 1 }), now + 256);
    await delivery.seal(JSON.stringify({ id: crypto.randomUUID(), ...identity, at: now + 257, receivedBytes: 1 }), now + 257);
    expect(spool.snapshot().coverageUnknownSince).toBe(now);
    expect(spool.snapshot().gaps).toHaveLength(32);
    spool.close(); const reopened = await DbTrafficSpool.open(root); expect(reopened.snapshot().coverageUnknownSince).toBe(now); reopened.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("detects a valid JSON state whose sealed body has changed", async () => {
  const root = await mkdtemp(join(tmpdir(), "traffic-corrupt-"));
  try {
    const spool = await DbTrafficSpool.open(root); const state = spool.snapshot();
    const body = { id: "batch", at: 1, receivedBytes: 5 };
    state.batches.push({ id: body.id, body: JSON.stringify(body), digest: await digestDbTraffic(body), at: 1, attempted: false, nextAttemptAt: 1, attempts: 0 });
    await spool.commit(state); spool.close();
    state.batches[0].body = JSON.stringify({ ...body, receivedBytes: 6 });
    const corrupt = JSON.stringify(state); await writeFile(join(root, "state.json"), corrupt);
    await expect(DbTrafficSpool.open(root)).rejects.toThrow("integrity mismatch");
    expect(await readFile(join(root, "state.json"), "utf8")).toBe(corrupt);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("keeps the previous snapshot when killed before the replacement file is synced", async () => {
  const { spawn } = await import("node:child_process");
  const root = await mkdtemp(join(tmpdir(), "traffic-midcommit-"));
  try {
    const initial = await DbTrafficSpool.open(root); const state = initial.snapshot(); state.openWindowSince = 100; await initial.commit(state); initial.close();
    const script = `const fs = require('node:fs/promises'); const originalOpen = fs.open;
      fs.open = async (...args) => { const file = await originalOpen(...args); if (String(args[0]).endsWith('.tmp')) file.sync = async () => { process.stdout.write('before-sync\\n'); await new Promise(() => {}); }; return file; };
      const { DbTrafficSpool } = require('./src/lib/observability/db-traffic-spool.ts');
      (async () => { const spool = await DbTrafficSpool.open(process.argv[1]); const next = spool.snapshot(); next.openWindowSince = 200; await spool.commit(next); })().catch(error => { console.error(error); process.exit(1); });`;
    const child = spawn(process.execPath, ["--import", "tsx", "-e", script, root], { stdio: ["ignore", "pipe", "pipe"] });
    try {
      await new Promise<void>((resolve, reject) => { child.stdout.once("data", () => resolve()); child.once("error", reject); child.once("exit", code => reject(new Error(`child exited ${code}`))); });
      child.kill("SIGKILL"); await new Promise<void>(resolve => child.once("exit", () => resolve()));
      const restored = await DbTrafficSpool.open(root); expect(restored.snapshot().openWindowSince).toBe(100); restored.close();
    } finally { child.kill("SIGKILL"); }
  } finally { await rm(root, { recursive: true, force: true }); }
}, 10000);

it("marks unknown coverage before removing an orphaned temporary state", async () => {
  const { DbTrafficDelivery } = await import("@/lib/observability/db-traffic-delivery");
  const root = await mkdtemp(join(tmpdir(), "traffic-orphan-"));
  try {
    const name = `.state-${crypto.randomUUID()}.tmp`; await writeFile(join(root, name), "unsealed");
    const spool = await DbTrafficSpool.open(root); const delivery = new DbTrafficDelivery(spool, { process: crypto.randomUUID(), release: "v1", deployment: "d1" });
    await delivery.start(Date.now());
    expect(spool.snapshot().coverageUnknownSince).not.toBeNull();
    expect(JSON.parse(spool.snapshot().gaps[0].body)).toMatchObject({ reason: "unknown_tail", certainty: "unknown", truncated: true });
    await expect(readFile(join(root, name), "utf8")).rejects.toThrow(); spool.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("retains a rejected unknown marker and preserves a later event when an earlier marker is acknowledged", async () => {
  const { DbTrafficDelivery } = await import("@/lib/observability/db-traffic-delivery");
  const root = await mkdtemp(join(tmpdir(), "traffic-coverage-revision-"));
  const a = { process: crypto.randomUUID(), release: "a", deployment: "a" };
  const b = { process: crypto.randomUUID(), release: "b", deployment: "b" };
  let now = 1_800_000_000_000;
  try {
    let spool = await DbTrafficSpool.open(root);
    let delivery = new DbTrafficDelivery(spool, a); await delivery.start(now); spool.close();
    now += 1000; spool = await DbTrafficSpool.open(root); delivery = new DbTrafficDelivery(spool, b); await delivery.start(now);
    expect(JSON.parse(spool.snapshot().gaps[0].body)).toMatchObject({ ...a, reason: "unknown_tail" });
    let sent = 0; await delivery.drain(async () => { sent++; return { ok: false, status: 400, retryAfter: null, limit: null }; }, () => now);
    expect(sent).toBe(1); expect(spool.snapshot().coverageReportedSince).toBeNull();
    spool.close(); now += 3600001; spool = await DbTrafficSpool.open(root); delivery = new DbTrafficDelivery(spool, b);
    await delivery.drain(async () => ({ ok: true, status: 200, retryAfter: null, limit: null }), () => now);
    expect(spool.snapshot().coverageReportedRevision).toBe(spool.snapshot().coverageRevision);
    spool.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("starts the new durable window at snapshot capture, not the later disk commit", async () => {
  const { DbTrafficDelivery } = await import("@/lib/observability/db-traffic-delivery");
  const root = await mkdtemp(join(tmpdir(), "traffic-capture-boundary-"));
  const identity = { process: crypto.randomUUID(), release: "a", deployment: "a" };
  const capturedAt = 1_800_000_000_000;
  try {
    const spool = await DbTrafficSpool.open(root); const delivery = new DbTrafficDelivery(spool, identity);
    await delivery.start(capturedAt);
    await delivery.seal(JSON.stringify({ id: crypto.randomUUID(), ...identity, at: capturedAt - 1000, receivedBytes: 1 }), capturedAt + 5000, undefined, capturedAt);
    expect(spool.snapshot().openWindowSince).toBe(capturedAt); spool.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("does not let an older unknown ACK consume a later unknown event", async () => {
  const { DbTrafficDelivery } = await import("@/lib/observability/db-traffic-delivery");
  const root = await mkdtemp(join(tmpdir(), "traffic-coverage-race-")); const now = 1_800_000_000_000;
  const a = { process: crypto.randomUUID(), release: "a", deployment: "a" }; const b = { process: crypto.randomUUID(), release: "b", deployment: "b" };
  try {
    let spool = await DbTrafficSpool.open(root); await new DbTrafficDelivery(spool, a).start(now); spool.close();
    spool = await DbTrafficSpool.open(root); const delivery = new DbTrafficDelivery(spool, b); await delivery.start(now + 1);
    const events: string[] = [];
    await delivery.drain(async (item, gap) => {
      const body = JSON.parse(item.body); if (gap && body.reason === "unknown_tail") {
        events.push(body.release);
        if (events.length === 1) await delivery.seal(JSON.stringify({ id: crypto.randomUUID(), ...b, at: now + 1, receivedBytes: 1 }), now + 1, now + 1);
      }
      return { ok: true, status: 200, retryAfter: null, limit: null };
    }, () => now + 1);
    expect(events).toEqual(["a", "b"]);
    expect(spool.snapshot().coverageReportedRevision).toBe(spool.snapshot().coverageRevision);
    spool.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("merges exit capsules before delivery without duplicating a committed recovery", async () => {
  const { DbTrafficDelivery } = await import("@/lib/observability/db-traffic-delivery");
  const { writeExitCapsule } = await import("@/lib/observability/db-traffic-capsule");
  const root = await mkdtemp(join(tmpdir(), "traffic-exit-recovery-")); const now = Date.now();
  const identity = { process: crypto.randomUUID(), release: "old", deployment: "old" };
  const batch = { id: crypto.randomUUID(), ...identity, at: now, dropped: 0, receivedBytes: 1, connections: 1, observedConnections: 1, rows: [], remainingRxBytes: 1, remaining: { async: 1, no_owner: 0, partial: 0, unsupported: 0, instrumentation: 0 }, droppedReceivedBytes: 0, unconfirmedReceivedBytes: 0, unconfirmedBatches: 0 };
  const capsule = { version: 1 as const, batches: [JSON.stringify(batch)], unknownAt: null };
  try {
    writeExitCapsule(root, capsule);
    let spool = await DbTrafficSpool.open(root); let delivery = new DbTrafficDelivery(spool, { ...identity, release: "new" }); await delivery.start(now);
    expect(spool.snapshot().batches.map(item => item.id)).toEqual([batch.id]); spool.close();
    // The same capsule remains if the owner dies after commit but before unlink.
    writeExitCapsule(root, capsule); spool = await DbTrafficSpool.open(root); delivery = new DbTrafficDelivery(spool, identity); await delivery.start(now + 1);
    expect(spool.snapshot().batches.map(item => item.id)).toEqual([batch.id]); spool.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("validates exit data before writing and preserves an existing attempted batch on recovery", async () => {
  const { DbTrafficDelivery } = await import("@/lib/observability/db-traffic-delivery"); const { writeExitCapsule } = await import("@/lib/observability/db-traffic-capsule");
  const { readdir } = await import("node:fs/promises"); const root = await mkdtemp(join(tmpdir(), "traffic-exit-safe-")); const now = Date.now();
  const identity = { process: crypto.randomUUID(), release: "old", deployment: "old" };
  const batch = { id: crypto.randomUUID(), ...identity, at: now, dropped: 0, receivedBytes: 1, connections: 1, observedConnections: 1, rows: [], remainingRxBytes: 1, remaining: { async: 1, no_owner: 0, partial: 0, unsupported: 0, instrumentation: 0 }, droppedReceivedBytes: 0, unconfirmedReceivedBytes: 0, unconfirmedBatches: 0 };
  try {
    expect(() => writeExitCapsule(root, { version: 1, batches: [JSON.stringify({ ...batch, private: "canary" })], unknownAt: null })).toThrow("invalid exit capsule batch");
    expect(await readdir(root)).toEqual([]);
    const spool = await DbTrafficSpool.open(root); const state = spool.snapshot(); const body = JSON.stringify(batch);
    state.batches.push({ id: batch.id, body, digest: await digestDbTraffic(batch), at: now, attempted: true, attempts: 4, nextAttemptAt: now + 50000 }); await spool.commit(state);
    writeExitCapsule(root, { version: 1, batches: [body], unknownAt: null });
    await new DbTrafficDelivery(spool, identity).start(now + 1);
    expect(spool.snapshot().batches).toHaveLength(1); expect(spool.snapshot().batches[0]).toMatchObject({ attempted: true, attempts: 4, nextAttemptAt: now + 50000 }); spool.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("recovers once after SIGKILL between the state commit and capsule deletion", async () => {
  const { spawn } = await import("node:child_process"); const { writeExitCapsule } = await import("@/lib/observability/db-traffic-capsule"); const { DbTrafficDelivery } = await import("@/lib/observability/db-traffic-delivery");
  const root = await mkdtemp(join(tmpdir(), "traffic-exit-kill-")); const now = Date.now(); const identity = { process: crypto.randomUUID(), release: "old", deployment: "old" };
  const batch = { id: crypto.randomUUID(), ...identity, at: now, dropped: 0, receivedBytes: 1, connections: 1, observedConnections: 1, rows: [], remainingRxBytes: 1, remaining: { async: 1, no_owner: 0, partial: 0, unsupported: 0, instrumentation: 0 }, droppedReceivedBytes: 0, unconfirmedReceivedBytes: 0, unconfirmedBatches: 0 };
  writeExitCapsule(root, { version: 1, batches: [JSON.stringify(batch)], unknownAt: null });
  const script = `const fs = require('node:fs/promises'); const unlink = fs.unlink; fs.unlink = async (...args) => { if (/exit-.*\\.json$/.test(String(args[0]))) { process.stdout.write('before-unlink\\n'); await new Promise(() => {}); } return unlink(...args); };
    const { DbTrafficSpool } = require('./src/lib/observability/db-traffic-spool.ts'); const { DbTrafficDelivery } = require('./src/lib/observability/db-traffic-delivery.ts');
    (async () => { const spool = await DbTrafficSpool.open(process.argv[1]); await new DbTrafficDelivery(spool, ${JSON.stringify(identity)}).start(Date.now()); })().catch(error => { console.error(error); process.exit(1); });`;
  const child = spawn(process.execPath, ["--import", "tsx", "-e", script, root], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise<void>((resolve, reject) => { child.stdout.once("data", () => resolve()); child.once("error", reject); child.once("exit", code => reject(new Error(`child exited ${code}`))); });
    child.kill("SIGKILL"); await new Promise<void>(resolve => child.once("exit", () => resolve()));
    const spool = await DbTrafficSpool.open(root); await new DbTrafficDelivery(spool, identity).start(Date.now());
    expect(spool.snapshot().batches.map(item => item.id)).toEqual([batch.id]); spool.close();
  } finally { child.kill("SIGKILL"); await rm(root, { recursive: true, force: true }); }
}, 15000);

it("isolates an invalid capsule, records unknown coverage and drains verified batches", async () => {
  const { DbTrafficDelivery } = await import("@/lib/observability/db-traffic-delivery"); const { readdir } = await import("node:fs/promises"); const root = await mkdtemp(join(tmpdir(), "traffic-exit-corrupt-"));
  const name = `exit-${crypto.randomUUID()}.json`; const corrupt = '{"private":"canary"}'; const now = Date.now();
  const identity = { process: crypto.randomUUID(), release: "v", deployment: "d" };
  try {
    const spool = await DbTrafficSpool.open(root); const state = spool.snapshot();
    const batch = { id: crypto.randomUUID(), ...identity, at: now, receivedBytes: 1 }; const body = JSON.stringify(batch);
    state.batches.push({ id: batch.id, body, digest: await digestDbTraffic(batch), at: now, attempted: true, nextAttemptAt: now, attempts: 1 });
    await spool.commit(state); await writeFile(join(root, name), corrupt);
    const delivery = new DbTrafficDelivery(spool, identity); await delivery.start(now);
    expect(spool.snapshot().coverageUnknownSince).not.toBeNull();
    const isolated = (await readdir(root)).find(item => item.startsWith("invalid-") && item.endsWith(name)); expect(isolated).toBeDefined();
    expect(await readFile(join(root, isolated!), "utf8")).toBe(corrupt);
    const sent: string[] = []; await delivery.drain(async item => { sent.push(item.id); return { ok: true, status: 200, retryAfter: null, limit: null }; }, () => now);
    expect(sent).toContain(batch.id); expect(spool.snapshot().batches).toHaveLength(0); spool.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("survives SIGKILL after atomically publishing an exit capsule", async () => {
  const { spawn } = await import("node:child_process"); const { readdir } = await import("node:fs/promises"); const { DbTrafficDelivery } = await import("@/lib/observability/db-traffic-delivery");
  const root = await mkdtemp(join(tmpdir(), "traffic-exit-reserve-")); const now = Date.now(); const identity = { process: crypto.randomUUID(), release: "v", deployment: "d" };
  const original = await DbTrafficSpool.open(root); const state = original.snapshot(); const value = { id: crypto.randomUUID(), ...identity, at: now, receivedBytes: 1 }; const body = JSON.stringify(value);
  state.batches.push({ id: value.id, body, digest: await digestDbTraffic(value), at: now, attempted: false, attempts: 0, nextAttemptAt: now }); await original.commit(state); original.close();
  const script = `const fs=require('node:fs'); const link=fs.linkSync; fs.linkSync=(...args)=>{link(...args);process.stdout.write('published\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0)};
    const {writeExitCapsule}=require('./src/lib/observability/db-traffic-capsule.ts'); writeExitCapsule(process.argv[1],{version:1,batches:[],unknownAt:1});`;
  const child = spawn(process.execPath, ["--import", "tsx", "-e", script, root], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise<void>((resolve, reject) => { child.stdout.once("data", () => resolve()); child.once("error", reject); child.once("exit", code => reject(new Error(`child exited ${code}`))); });
    child.kill("SIGKILL"); await new Promise<void>(resolve => child.once("exit", () => resolve()));
    const spool = await DbTrafficSpool.open(root); const delivery = new DbTrafficDelivery(spool, identity); await delivery.start(Date.now());
    const files = await readdir(root); expect(files.some(name => name.startsWith("invalid-"))).toBe(false); expect(files.some(name => name.startsWith(".exit-"))).toBe(true);
    expect(spool.snapshot().coverageUnknownSince).toBe(1); const sent: string[] = [];
    await delivery.drain(async item => { sent.push(item.id); return { ok: true, status: 200, retryAfter: null, limit: null }; });
    expect(sent).toContain(value.id); spool.close();
  } finally { child.kill("SIGKILL"); await rm(root, { recursive: true, force: true }); }
}, 15000);

it("never overwrites an existing capsule when hard-link publication reports EEXIST", async () => {
  const { spawnSync } = await import("node:child_process"); const { readdir } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "traffic-link-exists-"));
  try {
    const script = `const fs=require('node:fs'); const link=fs.linkSync; fs.linkSync=(a,b)=>{fs.writeFileSync(b,'prior-evidence');return link(a,b)};
      const {writeExitCapsule}=require('./src/lib/observability/db-traffic-capsule.ts'); try { writeExitCapsule(process.argv[1],{version:1,batches:[],unknownAt:1}); process.exitCode=2; } catch(e) { if(e.code!=='EEXIST') throw e; }`;
    const child = spawnSync(process.execPath, ["--import", "tsx", "-e", script, root], { encoding: "utf8" }); expect(child.status).toBe(0);
    const names = await readdir(root); const target = names.find(name => /^exit-.*\.json$/.test(name)); expect(target).toBeDefined();
    expect(await readFile(join(root, target!), "utf8")).toBe("prior-evidence"); expect(names.some(name => name.startsWith(".exit-"))).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("quarantines all conflicting capsules while preserving existing and unrelated batches", async () => {
  const { DbTrafficDelivery } = await import("@/lib/observability/db-traffic-delivery"); const { writeExitCapsule } = await import("@/lib/observability/db-traffic-capsule"); const { readdir } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "traffic-conflicts-")); const now = Date.now(); const identity = { process: crypto.randomUUID(), release: "v", deployment: "d" };
  const make = (id: string, n: number) => ({ id, ...identity, at: now, dropped: 0, receivedBytes: n, connections: 1, observedConnections: 1, rows: [], remainingRxBytes: n, remaining: { async: n, no_owner: 0, partial: 0, unsupported: 0, instrumentation: 0 }, droppedReceivedBytes: 0, unconfirmedReceivedBytes: 0, unconfirmedBatches: 0 });
  try {
    const spool = await DbTrafficSpool.open(root); const state = spool.snapshot(); const existing = make(crypto.randomUUID(), 1); const body = JSON.stringify(existing);
    state.batches.push({ id: existing.id, body, digest: await digestDbTraffic(existing), at: now, attempted: true, attempts: 3, nextAttemptAt: now + 10000 }); await spool.commit(state);
    const shared = crypto.randomUUID(); const good = make(crypto.randomUUID(), 4);
    for (const value of [make(existing.id, 2), make(shared, 1), make(shared, 2), good]) writeExitCapsule(root, { version: 1, batches: [JSON.stringify(value)], unknownAt: null });
    await new DbTrafficDelivery(spool, identity).start(now);
    expect(spool.snapshot().batches.map(item => item.id).sort()).toEqual([existing.id, good.id].sort());
    expect(spool.snapshot().batches.find(item => item.id === existing.id)).toMatchObject({ body, attempted: true, attempts: 3, nextAttemptAt: now + 10000 });
    expect((await readdir(root)).filter(name => name.startsWith("invalid-")).length).toBe(3); expect(spool.snapshot().coverageUnknownSince).not.toBeNull(); spool.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("does not send if isolating a corrupt capsule fails with an I/O error", async () => {
  const { spawn } = await import("node:child_process"); const root = await mkdtemp(join(tmpdir(), "traffic-isolation-io-")); const name = `exit-${crypto.randomUUID()}.json`;
  await writeFile(join(root, name), "{}");
  const script = `const fs=require('node:fs/promises'); fs.link=async()=>{throw Object.assign(new Error('fixture'),{code:'EIO'})};
    const {DbTrafficSpool}=require('./src/lib/observability/db-traffic-spool.ts');const {DbTrafficDelivery}=require('./src/lib/observability/db-traffic-delivery.ts');
    (async()=>{const s=await DbTrafficSpool.open(process.argv[1]);const d=new DbTrafficDelivery(s,{process:crypto.randomUUID(),release:'v',deployment:'d'});let sends=0;try{await d.start(Date.now());await d.drain(async()=>{sends++;return {ok:true,status:200,retryAfter:null,limit:null}})}catch(e){process.stdout.write(JSON.stringify({code:e.code,sends,unknown:s.snapshot().coverageUnknownSince!==null}));}s.close()})().catch(e=>{console.error(e);process.exit(1)});`;
  const child = spawn(process.execPath, ["--import", "tsx", "-e", script, root], { stdio: ["ignore", "pipe", "pipe"] }); let output = "";
  child.stdout.on("data", data => { output += String(data); });
  try {
    const status = await new Promise<number | null>(resolve => child.once("exit", resolve)); expect(status).toBe(0);
    expect(JSON.parse(output)).toEqual({ code: "EIO", sends: 0, unknown: true }); expect(await readFile(join(root, name), "utf8")).toBe("{}");
  } finally { child.kill("SIGKILL"); await rm(root, { recursive: true, force: true }); }
}, 15000);

it("does not start delivery when more than 128 capsules remain unread", async () => {
  const { DbTrafficDelivery } = await import("@/lib/observability/db-traffic-delivery"); const root = await mkdtemp(join(tmpdir(), "traffic-capsule-limit-"));
  try {
    for (let i = 0; i < 129; i++) await writeFile(join(root, `exit-${crypto.randomUUID()}.json`), "{}");
    const spool = await DbTrafficSpool.open(root); const delivery = new DbTrafficDelivery(spool, { process: crypto.randomUUID(), release: "v", deployment: "d" }); let sends = 0;
    await expect((async () => { await delivery.start(Date.now()); await delivery.drain(async () => { sends++; return { ok: true, status: 200, retryAfter: null, limit: null }; }); })()).rejects.toThrow("too many database traffic exit capsules");
    expect(sends).toBe(0); spool.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("isolates a schema-valid capsule whose stored content changed after writing", async () => {
  const { DbTrafficDelivery } = await import("@/lib/observability/db-traffic-delivery"); const { writeExitCapsule } = await import("@/lib/observability/db-traffic-capsule"); const { readdir } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "traffic-capsule-checksum-")); const now = Date.now(); const identity = { process: crypto.randomUUID(), release: "v", deployment: "d" };
  const batch = { id: crypto.randomUUID(), ...identity, at: now, dropped: 0, receivedBytes: 0, connections: 1, observedConnections: 1, rows: [{ source: "unknown", template: "unknown", queries: 1, failures: 0, rows: 0, queryMs: 0, logicalRowJsonBytes: 0, logicalMeasuredQueries: 0, rxBytes: 0, skipReasons: { budget: 0, unsupported_value: 0, error: 0 } }], remainingRxBytes: 0, remaining: { async: 0, no_owner: 0, partial: 0, unsupported: 0, instrumentation: 0 }, droppedReceivedBytes: 0, unconfirmedReceivedBytes: 0, unconfirmedBatches: 0 };
  try {
    const spool = await DbTrafficSpool.open(root); const state = spool.snapshot(); const good = { id: crypto.randomUUID(), ...identity, at: now, receivedBytes: 1 }; const body = JSON.stringify(good);
    state.batches.push({ id: good.id, body, digest: await digestDbTraffic(good), at: now, attempted: false, nextAttemptAt: now, attempts: 0 }); await spool.commit(state);
    writeExitCapsule(root, { version: 1, batches: [JSON.stringify(batch)], unknownAt: null });
    const name = (await readdir(root)).find(item => /^exit-.*\.json$/.test(item))!; const capsule = JSON.parse(await readFile(join(root, name), "utf8"));
    capsule.batches[0] = JSON.stringify({ ...batch, rows: [{ ...batch.rows[0], queries: 999 }] }); await writeFile(join(root, name), JSON.stringify(capsule));
    const delivery = new DbTrafficDelivery(spool, identity); await delivery.start(now);
    expect(spool.snapshot().coverageUnknownSince).not.toBeNull(); expect(spool.snapshot().batches.map(item => item.id)).toEqual([good.id]);
    const isolated = (await readdir(root)).find(item => item.startsWith("invalid-") && item.endsWith(name)); expect(isolated).toBeDefined();
    expect(await readFile(join(root, isolated!), "utf8")).toContain("999");
    const sent: string[] = []; await delivery.drain(async item => { sent.push(item.id); return { ok: true, status: 200, retryAfter: null, limit: null }; }, () => now);
    expect(sent).toContain(good.id); spool.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("detects exit capsule metadata changes", async () => {
  const { writeExitCapsule, readExitCapsules } = await import("@/lib/observability/db-traffic-capsule"); const { readdir } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "traffic-capsule-metadata-"));
  try {
    writeExitCapsule(root, { version: 1, batches: [], unknownAt: 1 }); const name = (await readdir(root)).find(item => /^exit-.*\.json$/.test(item))!;
    const capsule = JSON.parse(await readFile(join(root, name), "utf8")); capsule.unknownAt = 2; await writeFile(join(root, name), JSON.stringify(capsule));
    const result = await readExitCapsules(root); expect(result.files).toHaveLength(0); expect(result.invalid.map(item => item.name)).toEqual([name]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
