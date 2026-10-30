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

it("pauses only quarantine batches after a quarantine quota response", async () => {
  const root = await mkdtemp(join(tmpdir(), "traffic-quality-limit-")); const now = 1_800_000_000_000;
  const identity = { process: crypto.randomUUID(), release: "v1", deployment: "d1" };
  try {
    const spool = await DbTrafficSpool.open(root); const delivery = new DbTrafficDelivery(spool, identity);
    const first = crypto.randomUUID(), second = crypto.randomUUID(), normal = crypto.randomUUID();
    const batch = (id: string, failures: number) => ({ id, ...identity, at: now, receivedBytes: 0, rows: [{ queries: 1, failures }] });
    for (const value of [batch(first, 2), batch(second, 2), batch(normal, 0)]) await delivery.seal(JSON.stringify(value), now);
    const sent: string[] = [];
    await delivery.drain(async item => { sent.push(item.id); return item.id === first ? { ok: false, status: 429, retryAfter: 300, limit: "quarantine" } : { ok: true, status: 200, retryAfter: null, limit: null }; }, () => now);
    expect(sent).toEqual([first, normal]);
    expect(spool.snapshot().batches.map(item => item.id)).toEqual([first, second]);
    expect(spool.snapshot().batches.every(item => item.nextAttemptAt === now + 300000)).toBe(true);
    const later = crypto.randomUUID(); await delivery.seal(JSON.stringify(batch(later, 2)), now);
    expect(spool.snapshot().batches.find(item => item.id === later)?.nextAttemptAt).toBe(now + 300000);
    expect(spool.snapshot().globalNextAttemptAt).toBe(0); spool.close();
    const reopened = await DbTrafficSpool.open(root); const restarted = new DbTrafficDelivery(reopened, identity);
    const nextNormal = crypto.randomUUID(); await restarted.seal(JSON.stringify(batch(nextNormal, 0)), now + 1);
    const afterRestart: string[] = [];
    await restarted.drain(async item => { afterRestart.push(item.id); return { ok: true, status: 200, retryAfter: null, limit: null }; }, () => now + 1);
    expect(afterRestart).toEqual([nextNormal]);
    expect(reopened.snapshot().quarantineNextAttemptAt).toBe(now + 300000); reopened.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("pauses only diagnostic gaps after a gap quota response", async () => {
  const { digestDbTraffic } = await import("@/lib/observability/db-traffic-contract");
  const root = await mkdtemp(join(tmpdir(), "traffic-gap-limit-")); const now = 1_800_000_000_000;
  const identity = { process: crypto.randomUUID(), release: "v1", deployment: "d1" };
  try {
    const spool = await DbTrafficSpool.open(root); const state = spool.snapshot();
    for (let i = 0; i < 2; i++) { const body = { id: crypto.randomUUID(), reportedAt: now, reason: "overflow" }; state.gaps.push({ id: body.id, body: JSON.stringify(body), digest: await digestDbTraffic(body), at: now, attempted: false, nextAttemptAt: now, attempts: 0 }); }
    await spool.commit(state); const delivery = new DbTrafficDelivery(spool, identity);
    const normal = crypto.randomUUID(); await delivery.seal(JSON.stringify({ id: normal, ...identity, at: now + 1, receivedBytes: 0 }), now + 1);
    const sent: string[] = [];
    await delivery.drain(async (item, gap) => { sent.push(item.id); return gap ? { ok: false, status: 429, retryAfter: 300, limit: "gap" } : { ok: true, status: 200, retryAfter: null, limit: null }; }, () => now + 1);
    expect(sent).toEqual([state.gaps[0].id, normal]);
    expect(spool.snapshot().gaps.every(item => item.nextAttemptAt === now + 300001)).toBe(true);
    await delivery.rejectUnsafe(JSON.stringify({ id: crypto.randomUUID(), ...identity, at: now, receivedBytes: 1 }), now + 1);
    expect(spool.snapshot().gaps.every(item => item.nextAttemptAt === now + 300001)).toBe(true);
    expect(spool.snapshot().globalNextAttemptAt).toBe(0); spool.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});
