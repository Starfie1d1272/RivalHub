import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { setTimeout as delay } from "node:timers/promises";
import type { Pool } from "pg";
import { afterEach, expect, it, vi } from "vitest";

const observation = vi.hoisted(() => ({ queries: [] as string[] }));
vi.mock("@/db/client", async importOriginal => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const schema = await import("@/db/schema");
  return { ...actual, db: drizzle((actual.db as typeof actual.db & { $client: Pool }).$client, {
    schema, logger: { logQuery: query => observation.queries.push(query) },
  }) };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), cacheLife: vi.fn(), cacheTag: vi.fn() }));

import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { loadMizarScheduleWindow } from "@/lib/mizar/context";
import { getTournamentTeamDetail } from "@/lib/stats/tournament-query";
import { assertInstallationInTx, authenticateMizar, authorizeMizarPairing, hashCredential, pollMizarPairing, startMizarPairing } from "@/lib/mizar/installation";
import { GET, POST } from "@/app/api/mizar/[operation]/route";
import { seedFixture, seedMizarStatsHistory, withExtraMizarScheduleMatches, NOW } from "./harness/mizar";
import { createLocalPool } from "./harness/database";

const from = new Date("2026-09-28T00:00:00.000Z");
const to = new Date("2026-10-05T00:00:00.000Z");
const selectCount = () => observation.queries.filter(query => /^select\b/i.test(query)).length;
afterEach(() => vi.unstubAllEnvs());

async function authenticatedFixture() {
  const fixture = await seedFixture();
  // Disposable local credential; never use a production installation or token.
  const credential = `rh_mizar_${randomUUID()}_${"a".repeat(64)}`;
  await db.update(schema.mizarInstallations).set({ credentialHash: hashCredential(credential) }).where(eq(schema.mizarInstallations.id, fixture.installationId));
  return { ...fixture, authorization: `Bearer ${credential}` };
}

// The logger wraps real PostgreSQL execution, not a query mock. These bounds
// exclude transaction statements and do not measure wire bytes or Egress.
it("authenticates with one fresh four-field SELECT including the internal authorizer identity", async () => {
  const f = await authenticatedFixture();
  observation.queries = [];
  expect(await authenticateMizar(f.authorization)).toEqual({ id: f.installationId, competitionId: f.seasonId, revokedAt: null, authorizedByUserId: f.fixtureUserIds[0] });
  expect(selectCount()).toBe(1);
  await db.update(schema.mizarInstallations).set({ revokedAt: NOW }).where(eq(schema.mizarInstallations.id, f.installationId));
  observation.queries = [];
  await expect(authenticateMizar(f.authorization)).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(selectCount()).toBe(1);
});

it("checks transaction authority in one narrow SELECT and rejects wrong competition or revoked installation", async () => {
  const f = await seedFixture();
  observation.queries = [];
  const result = await db.transaction(tx => assertInstallationInTx(tx, f.installationId, f.seasonId));
  expect(result).toEqual({ id: f.installationId });
  expect(selectCount()).toBe(1);
  await expect(db.transaction(tx => assertInstallationInTx(tx, f.installationId, randomUUID()))).rejects.toMatchObject({ code: "FORBIDDEN" });
  await db.update(schema.mizarInstallations).set({ revokedAt: NOW }).where(eq(schema.mizarInstallations.id, f.installationId));
  await expect(db.transaction(tx => assertInstallationInTx(tx, f.installationId, f.seasonId))).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("retains the transaction SHARE barrier and refuses a waiting check after revocation commits", async () => {
  const f = await seedFixture();
  const pool = createLocalPool({ max: 3 });
  const a = await pool.connect();
  const b = await pool.connect();
  const observer = await pool.connect();
  const measured = drizzle(a, { schema });
  let pending: Promise<unknown> | undefined;
  try {
    await b.query("SET lock_timeout = '100ms'");
    await measured.transaction(async tx => {
      expect(await assertInstallationInTx(tx, f.installationId, f.seasonId)).toEqual({ id: f.installationId });
      await expect(b.query("UPDATE mizar_installations SET revoked_at = now() WHERE id = $1", [f.installationId])).rejects.toMatchObject({ code: "55P03" });
    });
    await b.query("BEGIN");
    await b.query("UPDATE mizar_installations SET revoked_at = now() WHERE id = $1", [f.installationId]);
    const aPid = (await a.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const bPid = (await b.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    pending = measured.transaction(tx => assertInstallationInTx(tx, f.installationId, f.seasonId)).catch(error => error);
    let blocked = false;
    const deadline = performance.now() + 3000;
    while (performance.now() < deadline) {
      const result = await observer.query("SELECT $2::integer = ANY(pg_blocking_pids($1::integer)) AS blocked", [aPid, bPid]);
      if (result.rows[0].blocked) { blocked = true; break; }
      await delay(10);
    }
    expect(blocked).toBe(true);
    await b.query("COMMIT");
    expect(await pending).toMatchObject({ code: "FORBIDDEN" });
  } finally {
    await b.query("ROLLBACK");
    if (pending) await pending;
    a.release(); b.release(); observer.release(); await pool.end();
  }
});

it("bounds schedule reads and rejects matches above the limit", async () => {
  const matchCount = 500;
  const f = await seedFixture();
  await withExtraMizarScheduleMatches(f, async add => {
    await add(matchCount - 1, new Date("2026-09-29T01:00:00.000Z"));
    observation.queries = [];
    const document = await loadMizarScheduleWindow(f.seasonId, from, to);
    const selects = selectCount();
    expect(document.matches).toHaveLength(matchCount);
    expect(selects).toBeGreaterThan(0);
    expect(selects).toBeLessThanOrEqual(3);
    expect(observation.queries.filter(query => /from "competition_entries"/.test(query))).toHaveLength(1);
    expect(document).not.toHaveProperty("viewer");
    expect(document.matches.every(match => !("assignedToViewer" in match))).toBe(true);
    expect(await loadMizarScheduleWindow(f.seasonId, from, to)).toEqual(document);
    observation.queries = [];
    const personalized = await loadMizarScheduleWindow(f.seasonId, from, to, f.fixtureUserIds[0]);
    const personalizedSelects = selectCount();
    expect(personalizedSelects).toBeLessThanOrEqual(4);
    expect(personalized.matches).toHaveLength(matchCount);
    expect(personalized.matches.every(match => match.assignedToViewer === false)).toBe(true);
    expect(personalized.viewer?.userId).toBe(f.fixtureUserIds[0]);
    console.info("MIZAR_SCHEDULE_READ_COST", JSON.stringify({ matchCount, selectCount: selects, personalizedSelects }));
    if (matchCount === 500) {
      await add(1, null);
      await expect(loadMizarScheduleWindow(f.seasonId, from, to)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    }
  });
});

it("keeps HTTP match 200/304 within nine SELECTs, personalized schedule within five, and fresh revocation across requests", async () => {
  const f = await authenticatedFixture();
  const matchUrl = `http://localhost/api/mizar/match?matchId=${f.matchId}`;
  const context = (operation: string) => ({ params: Promise.resolve({ operation }) });
  const request = (url: string, etag?: string) => new Request(url, { headers: { authorization: f.authorization, ...(etag ? { "if-none-match": etag } : {}) } });
  observation.queries = [];
  const match = await GET(request(matchUrl), context("match"));
  expect(match.status).toBe(200);
  const matchSelects = selectCount();
  expect(matchSelects).toBeGreaterThan(0);
  expect(matchSelects).toBeLessThanOrEqual(9);
  const document = await match.json();
  const etag = match.headers.get("etag")!;
  expect(etag).toBe(`"${document.revision}"`);
  expect(match.headers.get("cache-control")).toBe("private, no-cache");
  expect(match.headers.get("vary")).toBe("Authorization");
  observation.queries = [];
  const unchanged = await GET(request(matchUrl, etag), context("match"));
  expect(unchanged.status).toBe(304);
  expect(await unchanged.text()).toBe("");
  const notModifiedSelects = selectCount();
  expect(notModifiedSelects).toBeGreaterThan(1);
  expect(notModifiedSelects).toBeLessThanOrEqual(9);

  const scheduleSelects = await withExtraMizarScheduleMatches(f, async add => {
    await add(24, null);
    observation.queries = [];
    const schedule = await GET(request(`http://localhost/api/mizar/schedule?from=${from.toISOString()}&to=${to.toISOString()}`), context("schedule"));
    expect(schedule.status).toBe(200);
    expect((await schedule.json()).matches).toHaveLength(25);
    const scheduleSelects = selectCount();
    expect(scheduleSelects).toBeGreaterThan(0);
    expect(scheduleSelects).toBeLessThanOrEqual(5);
    return scheduleSelects;
  });
  const other = await seedFixture();
  expect((await GET(request(`http://localhost/api/mizar/match?matchId=${other.matchId}`), context("match"))).status).toBe(404);
  expect((await GET(new Request(matchUrl, { headers: { authorization: `Bearer rh_mizar_${randomUUID()}_${"b".repeat(64)}` } }), context("match"))).status).toBe(403);

  await db.update(schema.mizarInstallations).set({ revokedAt: NOW }).where(eq(schema.mizarInstallations.id, f.installationId));
  observation.queries = [];
  expect((await GET(request(matchUrl, etag), context("match"))).status).toBe(403);
  expect(selectCount()).toBe(1);
  await expect(authenticateMizar(f.authorization, { allowRevoked: true })).resolves.toMatchObject({ id: f.installationId, revokedAt: NOW });
  expect((await POST(new Request("http://localhost/api/mizar/disconnect", { method: "POST", headers: { authorization: f.authorization } }), context("disconnect"))).status).toBe(200);
  console.info("MIZAR_HTTP_READ_COST", JSON.stringify({ matchSelects, notModifiedSelects, scheduleSelects }));
});

it("authorizes the stats route and projects canonical team samples", async () => {
  const f = await authenticatedFixture();
  const other = await seedFixture();
  await seedMizarStatsHistory(f);
  const context = { params: Promise.resolve({ operation: "stats" }) };
  const request = (matchId: string) => new Request(`http://localhost/api/mizar/stats?matchId=${matchId}`, { headers: { authorization: f.authorization } });
  observation.queries = [];
  const response = await GET(request(f.matchId), context);
  expect(response.status).toBe(200);
  const body = await response.json();
  const selects = selectCount();
  expect(body.matchId).toBe(f.matchId);
  expect(body.competitionId).toBe(f.seasonId);
  expect(JSON.stringify(body)).not.toContain(f.authorization);
  expect(JSON.stringify(body)).not.toMatch(/credentialHash|@local\.test/);
  const first = body.entrants.find((entrant: { entryId: string }) => entrant.entryId === f.entryAId);
  expect(first.mapPerformance.maps).toHaveLength(2);
  expect(first.playerPerformance.players.find((player: { userId: string }) => player.userId === f.fixtureUserIds[0])).toMatchObject({ available: true, rating: 1.5, adr: null, sample: { maps: 2, ratingMaps: 2, adrRounds: null } });
  expect(first.playerPerformance.players.find((player: { userId: string }) => player.userId === f.fixtureUserIds[1])).toMatchObject({ available: true, rating: 1.25, adr: 80, sample: { maps: 1, ratingMaps: 1, adrRounds: 20 } });
  for (const entrant of body.entrants) {
    const canonical = await getTournamentTeamDetail({ seasonId: f.seasonId, teamId: entrant.entryId });
    expect(entrant.mapPerformance.maps).toEqual(canonical.maps.flatMap(({ mapName, results }) => results && results.played > 0 ? [{ mapName, played: results.played, wins: results.wins, winRate: results.wins / results.played }] : []));
    for (const player of entrant.playerPerformance.players) {
      const row = canonical.scoreboard.find(row => row.userId === player.userId);
      expect(player.rating).toBe(row?.avgRating ?? null);
      expect(player.adr).toBe(row?.avgAdr ?? null);
    }
  }
  expect((await GET(request(other.matchId), context)).status).toBe(404);
  expect((await GET(request("invalid"), context)).status).toBe(400);
  await db.update(schema.mizarInstallations).set({ revokedAt: NOW }).where(eq(schema.mizarInstallations.id, f.installationId));
  expect((await GET(request(f.matchId), context)).status).toBe(403);
  console.info("MIZAR_STATS_READ_COST", JSON.stringify({ selects, responseBytes: Buffer.byteLength(JSON.stringify(body)) }));
});

it("binds pairing and personalized schedule to the actual authorizer, keeps same-name people distinct and invalidates changed identity/assignments", async () => {
  vi.stubEnv("ADMIN_SESSION_SECRET", randomUUID().repeat(2));
  const f = await seedFixture();
  const authorizer = f.fixtureUserIds[0]!;
  const sameNameUser = f.fixtureUserIds[5]!;
  await db.insert(schema.seasonAdminGrants).values([authorizer, sameNameUser].map(userId => ({ userId, seasonId: f.seasonId })));
  for (const userId of [authorizer, sameNameUser]) {
    await db.update(schema.users).set({ displayName: "同名解说" }).where(eq(schema.users.id, userId));
  }
  async function pair(userId: string) {
    const start = await startMizarPairing("http://localhost");
    await authorizeMizarPairing(start.pairingId, f.seasonId, { userId, email: `${userId}@local.test`, role: "user", seasonIds: [f.seasonId] });
    const poll = await pollMizarPairing(start.pairingId, start.pollToken);
    expect(poll.status).toBe("authorized");
    if (poll.status !== "authorized") throw new Error("local pairing did not complete");
    expect(poll.displayName).toBe("同名解说");
    expect(poll.authorizedUser).toEqual({ userId, displayName: "同名解说" });
    return { start, poll, authorization: `Bearer ${poll.credential}` };
  }
  const a = await pair(authorizer);
  const b = await pair(sameNameUser);
  await db.insert(schema.matchCommentators).values({ matchId: f.matchId, userId: authorizer, addedByUserId: authorizer });
  // A caller-supplied viewerId cannot select another account's assignments.
  const url = `http://localhost/api/mizar/schedule?from=${from.toISOString()}&to=${to.toISOString()}&viewerId=${sameNameUser}`;
  async function read(authorization: string, etag?: string) {
    return GET(new Request(url, { headers: { authorization, ...(etag ? { "if-none-match": etag } : {}) } }), { params: Promise.resolve({ operation: "schedule" }) });
  }
  const first = await read(a.authorization);
  expect(first.status).toBe(200);
  const firstDocument = await first.json();
  const firstEtag = first.headers.get("etag")!;
  expect(firstDocument.viewer).toEqual({ userId: authorizer, displayName: "同名解说" });
  expect(firstDocument.matches[0]).toMatchObject({ matchId: f.matchId, assignedToViewer: true });
  expect((await read(a.authorization, firstEtag)).status).toBe(304);
  const switched = await read(b.authorization, firstEtag);
  expect(switched.status).toBe(200);
  const switchedDocument = await switched.json();
  expect(switchedDocument.viewer).toEqual({ userId: sameNameUser, displayName: "同名解说" });
  expect(switchedDocument.matches[0].assignedToViewer).toBe(false);
  expect(switchedDocument.revision).not.toBe(firstDocument.revision);
  const otherEtag = switched.headers.get("etag")!;

  await db.update(schema.users).set({ displayName: "更新后的昵称" }).where(eq(schema.users.id, authorizer));
  const renamed = await read(a.authorization, firstEtag);
  expect(renamed.status).toBe(200);
  const renamedDocument = await renamed.json();
  expect(renamedDocument.viewer.displayName).toBe("更新后的昵称");
  expect(renamedDocument.revision).not.toBe(firstDocument.revision);
  expect(await pollMizarPairing(a.start.pairingId, a.start.pollToken)).toMatchObject({ authorizedUser: renamedDocument.viewer });

  await db.delete(schema.matchCommentators).where(and(eq(schema.matchCommentators.matchId, f.matchId), eq(schema.matchCommentators.userId, authorizer)));
  const removed = await read(a.authorization, renamed.headers.get("etag")!);
  expect(removed.status).toBe(200);
  const removedDocument = await removed.json();
  expect(removedDocument.matches[0].assignedToViewer).toBe(false);
  expect(removedDocument.revision).not.toBe(renamedDocument.revision);
  await db.insert(schema.matchCommentators).values({ matchId: f.matchId, userId: authorizer, addedByUserId: authorizer });
  await db.update(schema.matchCommentators).set({ userId: sameNameUser }).where(and(eq(schema.matchCommentators.matchId, f.matchId), eq(schema.matchCommentators.userId, authorizer)));
  const corrected = await read(b.authorization, otherEtag);
  expect(corrected.status).toBe(200);
  expect((await corrected.json()).matches[0].assignedToViewer).toBe(true);
  // An administrator pairing for this event remains that administrator, even
  // though a different person now owns the commentary assignment.
  expect((await (await read(a.authorization)).json()).viewer.userId).toBe(authorizer);
  expect((await (await read(a.authorization)).json()).matches[0].assignedToViewer).toBe(false);
  await db.update(schema.users).set({ displayName: null, perfectName: "平台公开昵称" }).where(eq(schema.users.id, authorizer));
  await db.insert(schema.steamProfiles).values({ steam64: f.steam64[0]!, personaName: "Steam公开昵称", profileUrl: "https://example.test/profile" });
  const fallback = await read(a.authorization);
  expect((await fallback.json()).viewer).toEqual({ userId: authorizer, displayName: "Steam公开昵称" });
  expect(await pollMizarPairing(a.start.pairingId, a.start.pollToken)).toMatchObject({ displayName: "赛事管理员", authorizedUser: { userId: authorizer, displayName: "Steam公开昵称" } });
  for (const forbidden of ["@local.test", "credential", "authorizedByUserId", "email", "seasonIds", "role"]) {
    expect(JSON.stringify(firstDocument)).not.toContain(forbidden);
  }
  await db.update(schema.mizarInstallations).set({ revokedAt: NOW }).where(eq(schema.mizarInstallations.id, a.poll.installationId));
  expect((await read(a.authorization, removed.headers.get("etag")!)).status).toBe(403);
  await expect(pollMizarPairing(a.start.pairingId, a.start.pollToken)).rejects.toMatchObject({ code: "FORBIDDEN" });
});
