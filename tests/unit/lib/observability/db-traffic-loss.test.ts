import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { DbTrafficSpool } from "@/lib/observability/db-traffic-spool";
import { DbTrafficDelivery } from "@/lib/observability/db-traffic-delivery";

it("removes an invalid first batch and delivers ten later batches and the gap", async () => {
  const root = await mkdtemp(join(tmpdir(), "traffic-failure-"));
  const now = 1_800_000_000_000;
  const identity = { process: crypto.randomUUID(), release: "v1", deployment: "d1" };
  try {
    const spool = await DbTrafficSpool.open(root); const delivery = new DbTrafficDelivery(spool, identity);
    const ids: string[] = [];
    for (let i = 0; i < 11; i++) { const id = crypto.randomUUID(); ids.push(id); await delivery.seal(JSON.stringify({ id, ...identity, at: now + i, receivedBytes: 1 }), now + i); }
    const delivered: string[] = []; const gaps: string[] = [];
    const send = async (item: { id: string; body: string }, gap: boolean) => {
      if (gap) { gaps.push(item.body); return { ok: true, status: 200, retryAfter: null, limit: null }; }
      if (item.id === ids[0]) return { ok: false, status: 400, retryAfter: null, limit: null };
      delivered.push(item.id); return { ok: true, status: 200, retryAfter: null, limit: null };
    };
    await delivery.drain(send, () => now + 100);
    await delivery.drain(send, () => now + 100);
    expect(delivered).toEqual(ids.slice(1));
    expect(gaps.map(body => JSON.parse(body))).toContainEqual(expect.objectContaining({ reason: "rejected", certainty: "unconfirmed" }));
    expect(spool.snapshot().batches).toHaveLength(0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("backs off all queued batches on a network failure and resumes without changing identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "traffic-network-"));
  let now = 1_800_000_000_000;
  const identity = { process: crypto.randomUUID(), release: "v1", deployment: "d1" };
  try {
    const spool = await DbTrafficSpool.open(root); const delivery = new DbTrafficDelivery(spool, identity);
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    for (const id of ids) await delivery.seal(JSON.stringify({ id, ...identity, at: now, receivedBytes: 1 }), now);
    let attempts = 0;
    await delivery.drain(async () => { attempts++; return { ok: false, status: 503, retryAfter: null, limit: null }; }, () => now);
    expect(attempts).toBe(1);
    expect(spool.snapshot().batches.every(item => item.nextAttemptAt > now)).toBe(true);
    const extra = crypto.randomUUID(); ids.push(extra);
    await delivery.seal(JSON.stringify({ id: extra, ...identity, at: now, receivedBytes: 1 }), now);
    expect(spool.snapshot().batches.every(item => item.nextAttemptAt > now)).toBe(true);
    now += 600000; const sent: string[] = [];
    await delivery.drain(async item => { sent.push(item.id); return { ok: true, status: 200, retryAfter: null, limit: null }; }, () => now);
    expect(sent).toEqual(ids);
    expect(spool.snapshot().batches).toHaveLength(0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it.each([401, 403, 429])("pauses the whole queue on authentication or daily limit %i", async status => {
  const root = await mkdtemp(join(tmpdir(), "traffic-global-limit-"));
  const now = 1_800_000_000_000;
  const identity = { process: crypto.randomUUID(), release: "v1", deployment: "d1" };
  try {
    const spool = await DbTrafficSpool.open(root); const delivery = new DbTrafficDelivery(spool, identity);
    for (let i = 0; i < 2; i++) await delivery.seal(JSON.stringify({ id: crypto.randomUUID(), ...identity, at: now, receivedBytes: 1 }), now);
    let calls = 0;
    await delivery.drain(async () => { calls++; return { ok: false, status, retryAfter: 300, limit: status === 429 ? "daily" : null }; }, () => now);
    expect(calls).toBe(1);
    expect(spool.snapshot().batches.every(item => item.nextAttemptAt === now + 300000)).toBe(true);
    spool.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it.each([[409, "identity_conflict"], [410, "expired"], [413, "rejected"]] as const)("removes permanent HTTP %i and preserves a %s gap", async (status, reason) => {
  const root = await mkdtemp(join(tmpdir(), "traffic-permanent-")); const now = 1_800_000_000_000;
  const identity = { process: crypto.randomUUID(), release: "v1", deployment: "d1" };
  try {
    const spool = await DbTrafficSpool.open(root); const delivery = new DbTrafficDelivery(spool, identity);
    await delivery.seal(JSON.stringify({ id: crypto.randomUUID(), ...identity, at: now, receivedBytes: 42 }), now);
    const sentGaps: unknown[] = [];
    await delivery.drain(async (item, gap) => { if (gap) { sentGaps.push(JSON.parse(item.body)); return { ok: true, status: 200, retryAfter: null, limit: null }; } return { ok: false, status, retryAfter: null, limit: null }; }, () => now);
    expect(sentGaps).toContainEqual(expect.objectContaining({ reason, certainty: "unconfirmed", receivedBytes: 42 }));
    expect(spool.snapshot().batches).toHaveLength(0); spool.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});
