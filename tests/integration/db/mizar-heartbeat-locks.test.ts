import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";

const barrier = vi.hoisted(() => ({ wait: undefined as undefined | (() => Promise<void>) }));
// Only scheduling is controlled. Authentication, transactions, locks and writes
// all execute against the runner's disposable PostgreSQL database.
vi.mock("@/lib/mizar/installation", async original => {
  const actual = await original<typeof import("@/lib/mizar/installation")>();
  return { ...actual, assertInstallationInTx: async (...args: Parameters<typeof actual.assertInstallationInTx>) => {
    const result = await actual.assertInstallationInTx(...args);
    await barrier.wait?.();
    return result;
  } };
});

import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { ingestMizarReliable } from "@/lib/mizar/reliable";
import { claimMizarSource } from "@/lib/mizar/source";
import { loadMizarMatchDocumentInTx } from "@/lib/mizar/context";
import { RELIABLE_EVENT_SCHEMA_VERSION } from "@/lib/mizar/protocol";
import { touchMizarInstallation } from "@/lib/mizar/heartbeat";
import { createLocalPool } from "./harness/database";
import { seedFixture, NOW } from "./harness/mizar";

it.each(Array.from({ length: 100 }, (_, round) => round))("commits concurrent reliable requests without a heartbeat upgrade cycle, round %i", async () => {
  const f = await seedFixture();
  const event = {
    schemaVersion: RELIABLE_EVENT_SCHEMA_VERSION, idempotencyKey: `heartbeat-${randomUUID()}`,
    cursor: { producerInstanceId: f.producerInstanceId, liveSessionId: f.liveSessionId, runtimeSeq: 1, programSourceGeneration: 0, programReceiveSequence: 1, mapEpoch: 1 },
    observedAt: NOW.toISOString(), matchId: f.matchId, competitionId: f.seasonId,
    contextRevision: f.contextRevision, mapId: f.mapOneId, mapName: "de_ancient",
    entryAId: f.entryAId, entryBId: f.entryBId,
    evidence: { identity: "matched", telemetryFresh: true, contextFresh: true, source: "runtime-transition" },
    kind: "map_started", payload: {},
  };
  let arrived = 0;
  let release!: () => void;
  const bothAuthenticated = new Promise<void>(resolve => { release = resolve; });
  barrier.wait = async () => { if (++arrived === 2) release(); await bothAuthenticated; };
  const started = performance.now();
  try {
    const results = await Promise.allSettled([1, 2].map(() => ingestMizarReliable(f.installationId, f.seasonId, event, 1, f.steam64)));
    const failureCodes = results.flatMap(result => {
      if (result.status === "fulfilled") return [];
      let error = result.reason;
      while (error?.cause) error = error.cause;
      return [error?.code ?? "unknown"];
    });
    console.info(JSON.stringify({ scenario: "installation-share-match-heartbeat", elapsedMs: performance.now() - started, failureCodes, statuses: results.map(result => result.status) }));
    expect(results.map(result => result.status)).toEqual(["fulfilled", "fulfilled"]);
    const values = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
    expect(values.filter(value => value.duplicate)).toHaveLength(1);
    expect(await db.select().from(schema.mizarReliableReceipts).where(eq(schema.mizarReliableReceipts.idempotencyKey, event.idempotencyKey))).toHaveLength(1);
    expect(await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.targetId, f.matchId), eq(schema.auditLogs.action, "mizar.reliable.accept")))).toHaveLength(1);
  } finally { barrier.wait = undefined; }
});


it("throttles heartbeat writes, preserves later timestamps and ignores revoked/cross-event installations", async () => {
  const f = await seedFixture();
  const installation = () => db.query.mizarInstallations.findFirst({ where: eq(schema.mizarInstallations.id, f.installationId) });
  await touchMizarInstallation(f.installationId, randomUUID());
  expect((await installation())!.lastSeenAt).toBeNull();
  await touchMizarInstallation(f.installationId, f.seasonId);
  const first = (await installation())!.lastSeenAt;
  expect(first).not.toBeNull();
  await touchMizarInstallation(f.installationId, f.seasonId);
  expect((await installation())!.lastSeenAt).toEqual(first);
  const future = new Date(Date.now() + 60_000);
  await db.update(schema.mizarInstallations).set({ lastSeenAt: future }).where(eq(schema.mizarInstallations.id, f.installationId));
  await touchMizarInstallation(f.installationId, f.seasonId);
  expect((await installation())!.lastSeenAt).toEqual(future);
  await db.update(schema.mizarInstallations).set({ lastSeenAt: null, revokedAt: new Date() }).where(eq(schema.mizarInstallations.id, f.installationId));
  await touchMizarInstallation(f.installationId, f.seasonId);
  expect((await installation())!.lastSeenAt).toBeNull();
});

it("commits a competing source takeover and exact claim retry with the same installation SHARE barrier", async () => {
  const f = await seedFixture();
  const context = await db.transaction(tx => loadMizarMatchDocumentInTx(tx, f.matchId, f.seasonId));
  let arrived = 0;
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  barrier.wait = async () => { if (++arrived === 2) release(); await ready; };
  const input = { matchId: f.matchId, producerInstanceId: "takeover-fixture", liveSessionId: "takeover-live-fixture",
    programSourceGeneration: 0, mapEpoch: 1, contextRevision: context.revision, takeover: true,
    lineupSteam64: f.steam64, allowLineupMismatch: false };
  try {
    const results = await Promise.all([1, 2].map(() => claimMizarSource(f.installationId, f.seasonId, input)));
    expect(results.every(result => result.claimed)).toBe(true);
    expect(new Set(results.map(result => result.authorityRevision)).size).toBe(1);
    expect(await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.targetId, f.matchId), eq(schema.auditLogs.action, "mizar.source.claim")))).toHaveLength(1);
  } finally { barrier.wait = undefined; }
});

it("bounds a display touch behind an authority SHARE and never reports it as a business failure", async () => {
  const f = await seedFixture();
  const pool = createLocalPool({ max: 1 });
  const blocker = await pool.connect();
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM mizar_installations WHERE id=$1 FOR SHARE", [f.installationId]);
    const started = performance.now();
    await expect(touchMizarInstallation(f.installationId, f.seasonId)).resolves.toBeUndefined();
    expect(performance.now() - started).toBeLessThan(1000);
  } finally { await blocker.query("ROLLBACK"); blocker.release(); await pool.end(); }
});
