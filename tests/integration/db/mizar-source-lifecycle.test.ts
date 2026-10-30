import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { seedFixture } from "./harness/mizar";

const auth = vi.hoisted(() => ({ userId: "", role: "user" }));
vi.mock("@/lib/auth/session", () => ({ requireSeasonAdmin: async () => auth }));
import { readMizarSourceStatus, releaseMizarSource } from "@/lib/mizar/source";
import { closeCompletedSource, listSourceSessions } from "@/lib/mizar/source-management";

it("resolves only exact installation intents, including ambiguous and finished sources", async () => {
  const f = await seedFixture();
  const key = { matchId: f.matchId, producerInstanceId: f.producerInstanceId, liveSessionId: f.liveSessionId };
  expect(await readMizarSourceStatus(f.installationBId, f.seasonId, key)).toEqual({ status: "not_found" });
  await expect(readMizarSourceStatus(f.installationId, randomUUID(), key)).rejects.toThrow();
  await db.update(schema.matches).set({ status: "finished", completedAt: new Date(), scoreA: 2, scoreB: 0 }).where(eq(schema.matches.id, f.matchId));
  expect(await readMizarSourceStatus(f.installationId, f.seasonId, key)).toMatchObject({ status: "found", source: { sessionId: f.sessionId, state: "open", matchStatus: "finished", authorityRevision: 1 } });
  await releaseMizarSource(f.installationId, f.seasonId, key, 1);
  await releaseMizarSource(f.installationId, f.seasonId, key, 1);
  await db.insert(schema.matchLiveSessions).values({ ...key, installationId: f.installationId, authorityRevision: 2, contextRevision: f.contextRevision, programSourceGeneration: 0, mapEpoch: 0 });
  expect(await readMizarSourceStatus(f.installationId, f.seasonId, key)).toEqual({ status: "ambiguous" });
  expect(await readMizarSourceStatus(f.installationId, f.seasonId, { ...key, authorityRevision: 1 })).toMatchObject({ status: "found", source: { state: "closed", closeReason: "released" } });
  await releaseMizarSource(f.installationId, f.seasonId, key, 1);
  await db.update(schema.matchLiveSessions).set({ closeReason: "handover" }).where(eq(schema.matchLiveSessions.id, f.sessionId));
  await expect(releaseMizarSource(f.installationId, f.seasonId, key, 1)).rejects.toThrow();
  await expect(releaseMizarSource(f.installationBId, f.seasonId, key, 1)).rejects.toThrow();
  expect((await db.select().from(schema.matchLiveSessions).where(and(eq(schema.matchLiveSessions.matchId, f.matchId), eq(schema.matchLiveSessions.authorityRevision, 2))))[0].closedAt).toBeNull();
});

it("checks receipt changes, quiet period, authority and concurrent precise cleanup without altering history", async () => {
  const f = await seedFixture();
  auth.userId = f.fixtureUserIds[0]!;
  await db.insert(schema.seasonAdminGrants).values({ userId: auth.userId, seasonId: f.seasonId });
  const old = new Date(Date.now() - 30 * 60_000);
  await db.update(schema.matches).set({ status: "finished", completedAt: old, scoreA: 2, scoreB: 0 }).where(eq(schema.matches.id, f.matchId));
  await db.update(schema.matchLiveSessions).set({ openedAt: old }).where(eq(schema.matchLiveSessions.id, f.sessionId));
  const read = async () => (await listSourceSessions(f.seasonId)).rows.find(row => row.sessionId === f.sessionId)!;
  const command = (row: Awaited<ReturnType<typeof read>>) => ({ sessionId: row.sessionId, identity: row.identity, expectedVersion: row.expectedVersion, reason: "" });
  const before = await read();
  expect(before.blockedReason).toBeNull();
  await expect(closeCompletedSource(f.seasonId, f.fixtureUserIds[1]!, command(before))).rejects.toThrow();
  await db.insert(schema.mizarReliableReceipts).values({ sessionId: f.sessionId, idempotencyKey: randomUUID(), eventHash: "fixture", kind: "map_player_snapshot", outcome: "observed" });
  expect(await closeCompletedSource(f.seasonId, auth.userId, command(before))).toEqual({ status: "changed" });
  const recent = await read();
  expect(recent.latestReceipt?.kind).toBe("map_player_snapshot");
  expect(recent.blockedReason).toContain("15 分钟");
  expect(await closeCompletedSource(f.seasonId, auth.userId, command(recent))).toMatchObject({ status: "blocked" });
  await db.update(schema.mizarReliableReceipts).set({ acceptedAt: old }).where(eq(schema.mizarReliableReceipts.sessionId, f.sessionId));
  const ready = await read();
  const intent = randomUUID(), pairing = randomUUID();
  await db.insert(schema.dakPairingIntents).values({ id: intent, pollTokenHash: randomUUID(), expiresAt: new Date(Date.now() + 60_000) });
  await db.insert(schema.dakPairings).values({ id: pairing, pairingIntentId: intent, userId: auth.userId, tokenHash: randomUUID(), scopes: [], seasonIds: [f.seasonId] });
  await db.insert(schema.matchDemoImports).values({ seasonId: f.seasonId, matchId: f.matchId, matchMapId: f.mapOneId, stageKey: "fixture-stage", demoSha256: "a".repeat(64), payloadSha256: "b".repeat(64), contractVersion: "rivalhub-demo-evidence/1", semanticProfile: "fixture", analysisVersion: "fixture", evidenceRevision: "fixture", status: "confirmed", payload: {}, submittedByPairingId: pairing, confirmedAt: old });
  const matchBefore = await db.select().from(schema.matches).where(eq(schema.matches.id, f.matchId));
  const mapsBefore = await db.select().from(schema.matchMaps).where(eq(schema.matchMaps.matchId, f.matchId));
  const receiptsBefore = await db.select().from(schema.mizarReliableReceipts).where(eq(schema.mizarReliableReceipts.sessionId, f.sessionId));
  const demosBefore = await db.select().from(schema.matchDemoImports).where(eq(schema.matchDemoImports.matchId, f.matchId));
  const results = await Promise.all([closeCompletedSource(f.seasonId, auth.userId, command(ready)), closeCompletedSource(f.seasonId, auth.userId, command(ready))]);
  expect(results.map(r => r.status).sort()).toEqual(["already_closed", "closed"]);
  expect(await db.select().from(schema.matches).where(eq(schema.matches.id, f.matchId))).toEqual(matchBefore);
  expect(await db.select().from(schema.matchMaps).where(eq(schema.matchMaps.matchId, f.matchId))).toEqual(mapsBefore);
  expect(await db.select().from(schema.mizarReliableReceipts).where(eq(schema.mizarReliableReceipts.sessionId, f.sessionId))).toEqual(receiptsBefore);
  expect(await db.select().from(schema.matchDemoImports).where(eq(schema.matchDemoImports.matchId, f.matchId))).toEqual(demosBefore);
  expect(await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.targetId, f.matchId), eq(schema.auditLogs.action, "mizar.source.admin_cleanup")))).toHaveLength(1);
});

it("authenticates the status route and never permits a revoked installation", async () => {
  const f = await seedFixture();
  const { hashCredential } = await import("@/lib/mizar/installation");
  const { GET } = await import("@/app/api/mizar/[operation]/route");
  const syntheticToken = `rh_mizar_${randomUUID()}_${"a".repeat(64)}`;
  await db.update(schema.mizarInstallations).set({ credentialHash: hashCredential(syntheticToken) }).where(eq(schema.mizarInstallations.id, f.installationId));
  const query = new URLSearchParams({ matchId: f.matchId, producerInstanceId: f.producerInstanceId, liveSessionId: f.liveSessionId });
  const invoke = (authorization: string | null) => GET(new Request(`http://localhost/api/mizar/source-status?${query}`, { headers: authorization ? { authorization } : {} }), { params: Promise.resolve({ operation: "source-status" }) });
  expect((await invoke(null)).status).toBe(403);
  const response = await invoke(`Bearer ${syntheticToken}`);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.json();
  expect(body).toMatchObject({ status: "found", source: { sessionId: f.sessionId, competitionId: f.seasonId } });
  expect(JSON.stringify(body)).not.toContain("credential");
  await db.update(schema.mizarInstallations).set({ revokedAt: new Date() }).where(eq(schema.mizarInstallations.id, f.installationId));
  expect((await invoke(`Bearer ${syntheticToken}`)).status).toBe(403);
});

it("blocks unconfirmed, future and active matches and keeps the owner/super-admin boundary", async () => {
  const f = await seedFixture();
  auth.userId = f.fixtureUserIds[0]!;
  await db.insert(schema.seasonAdminGrants).values({ userId: auth.userId, seasonId: f.seasonId });
  const old = new Date(Date.now() - 3_600_000);
  await db.update(schema.matchLiveSessions).set({ openedAt: old }).where(eq(schema.matchLiveSessions.id, f.sessionId));
  const read = async () => (await listSourceSessions(f.seasonId)).rows.find(row => row.sessionId === f.sessionId)!;
  for (const state of [
    { status: "in_progress" as const, completedAt: null, scoreA: null, scoreB: null },
    { status: "cancelled" as const, completedAt: old, scoreA: null, scoreB: null },
    { status: "finished" as const, completedAt: new Date(Date.now() + 3_600_000), scoreA: 2, scoreB: 0 },
    { status: "finished" as const, completedAt: old, scoreA: null, scoreB: null },
  ]) {
    await db.update(schema.matches).set(state).where(eq(schema.matches.id, f.matchId));
    const row = await read();
    expect(await closeCompletedSource(f.seasonId, auth.userId, { sessionId: row.sessionId, identity: row.identity, expectedVersion: row.expectedVersion, reason: "" })).toMatchObject({ status: "blocked" });
  }
  await db.update(schema.matches).set({ status: "finished", completedAt: old, scoreA: 2, scoreB: 0 }).where(eq(schema.matches.id, f.matchId));
  const row = await read();
  const command = { sessionId: row.sessionId, identity: row.identity, expectedVersion: row.expectedVersion, reason: "" };
  await db.update(schema.matches).set({ updatedAt: new Date() }).where(eq(schema.matches.id, f.matchId));
  expect(await closeCompletedSource(f.seasonId, auth.userId, command)).toEqual({ status: "changed" });
  const current = await read();
  const currentCommand = { ...command, expectedVersion: current.expectedVersion };
  await db.delete(schema.seasonAdminGrants).where(and(eq(schema.seasonAdminGrants.userId, auth.userId), eq(schema.seasonAdminGrants.seasonId, f.seasonId)));
  await expect(closeCompletedSource(f.seasonId, auth.userId, currentCommand)).rejects.toThrow();
  const other = f.fixtureUserIds[1]!;
  await db.update(schema.users).set({ role: "super_admin" }).where(eq(schema.users.id, other));
  await expect(closeCompletedSource(f.seasonId, other, currentCommand)).rejects.toThrow();
  expect(await closeCompletedSource(f.seasonId, other, { ...currentCommand, reason: "核对赛后来源" })).toEqual({ status: "closed" });
});

it("serializes close with reliable ingress and rejects a late event after closing", async () => {
  const f = await seedFixture();
  auth.userId = f.fixtureUserIds[0]!;
  await db.insert(schema.seasonAdminGrants).values({ userId: auth.userId, seasonId: f.seasonId });
  const old = new Date(Date.now() - 3_600_000);
  await db.update(schema.matches).set({ status: "finished", completedAt: old, scoreA: 2, scoreB: 0 }).where(eq(schema.matches.id, f.matchId));
  await db.update(schema.matchLiveSessions).set({ openedAt: old }).where(eq(schema.matchLiveSessions.id, f.sessionId));
  const row = (await listSourceSessions(f.seasonId)).rows.find(item => item.sessionId === f.sessionId)!;
  const { ingestMizarReliable } = await import("@/lib/mizar/reliable");
  const { RELIABLE_EVENT_SCHEMA_VERSION } = await import("@/lib/mizar/protocol");
  const event = { schemaVersion: RELIABLE_EVENT_SCHEMA_VERSION, idempotencyKey: randomUUID(), cursor: { producerInstanceId: f.producerInstanceId, liveSessionId: f.liveSessionId, runtimeSeq: 1, programSourceGeneration: 0, programReceiveSequence: 1, mapEpoch: 1 }, observedAt: old.toISOString(), matchId: f.matchId, competitionId: f.seasonId, contextRevision: f.contextRevision, mapId: f.mapOneId, mapName: "de_ancient", entryAId: f.entryAId, entryBId: f.entryBId, evidence: { identity: "matched", telemetryFresh: true, contextFresh: true, source: "runtime-transition" }, kind: "series_ended", payload: { scoreA: 2, scoreB: 0 } };
  const [close, ingest] = await Promise.allSettled([closeCompletedSource(f.seasonId, auth.userId, { sessionId: row.sessionId, identity: row.identity, expectedVersion: row.expectedVersion, reason: "" }), ingestMizarReliable(f.installationId, f.seasonId, event, f.authorityRevision)]);
  expect(close.status).toBe("fulfilled");
  if (close.status !== "fulfilled") throw close.reason;
  if (close.value.status === "closed") expect(ingest.status).toBe("rejected");
  else { expect(close.value.status).toBe("changed"); expect(ingest.status).toBe("fulfilled"); }
  const source = (await db.select().from(schema.matchLiveSessions).where(eq(schema.matchLiveSessions.id, f.sessionId)))[0]!;
  if (source.closedAt) await expect(ingestMizarReliable(f.installationId, f.seasonId, { ...event, idempotencyKey: randomUUID() }, f.authorityRevision)).rejects.toThrow();
});

it("serializes precise cleanup with installation revocation", async () => {
  const f = await seedFixture();
  auth.userId = f.fixtureUserIds[0]!;
  await db.insert(schema.seasonAdminGrants).values({ userId: auth.userId, seasonId: f.seasonId });
  const old = new Date(Date.now() - 3_600_000);
  await db.update(schema.matches).set({ status: "finished", completedAt: old, scoreA: 2, scoreB: 0 }).where(eq(schema.matches.id, f.matchId));
  await db.update(schema.matchLiveSessions).set({ openedAt: old }).where(eq(schema.matchLiveSessions.id, f.sessionId));
  const row = (await listSourceSessions(f.seasonId)).rows.find(item => item.sessionId === f.sessionId)!;
  const { revokeMizarInstallation } = await import("@/lib/mizar/installation");
  const [close, revoke] = await Promise.all([closeCompletedSource(f.seasonId, auth.userId, { sessionId: row.sessionId, identity: row.identity, expectedVersion: row.expectedVersion, reason: "" }), revokeMizarInstallation(f.installationId, f.seasonId, auth.userId)]);
  expect(["closed", "already_closed"]).toContain(close.status);
  expect(revoke.revoked).toBe(true);
  const source = (await db.select().from(schema.matchLiveSessions).where(eq(schema.matchLiveSessions.id, f.sessionId)))[0]!;
  expect(["admin_completed_cleanup", "revoked"]).toContain(source.closeReason);
});
