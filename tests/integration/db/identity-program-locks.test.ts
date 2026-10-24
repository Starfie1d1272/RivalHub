import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { expect, it, vi } from "vitest";
const revision = vi.hoisted(() => ({ legacy: false }));
// Only select the prior caller boundary. Every transaction, trigger and wait
// below is real PostgreSQL; the new mode calls the production fence unchanged.
vi.mock("@/lib/identity/merge-locks", async original => {
  const actual = await original<typeof import("@/lib/identity/merge-locks")>();
  return { lockUserMergeEventClosureInTx: async (...args: Parameters<typeof actual.lockUserMergeEventClosureInTx>) => {
    if (!revision.legacy) await actual.lockUserMergeEventClosureInTx(...args);
  } };
});
vi.mock("@/lib/identity/statistics-invalidation", async original => {
  const actual = await original<typeof import("@/lib/identity/statistics-invalidation")>();
  return { ...actual, lockDemoIdentityInvalidationSeasonsInTx: async (...args: Parameters<typeof actual.lockDemoIdentityInvalidationSeasonsInTx>) => {
    if (!revision.legacy) await actual.lockDemoIdentityInvalidationSeasonsInTx(...args);
  } };
});
import { retireSeasonGameplaySteamIdentityInTx } from "@/lib/demo-integration/review";
import * as schema from "@/db/schema";
import { buildUserMergePreflight, executeUserMergeInTx } from "@/lib/identity/merge";
import { createLocalPool, testSteam64 } from "./harness/database";
import { seedFixture } from "./harness/mizar";

it.each([
  { legacy: true, command: "merge" }, { legacy: false, command: "merge" },
  { legacy: true, command: "retire" }, { legacy: false, command: "retire" },
])("actual identity $command versus official outbox program barrier, legacy=$legacy", async ({ legacy, command }) => {
  revision.legacy = legacy;
  const f = await seedFixture();
  const pool = createLocalPool({ max: 3 });
  const a = await pool.connect(); const b = await pool.connect(); const observer = await pool.connect();
  const database = drizzle(a, { schema });
  let pending: Promise<{ code?: string; message?: string }> | undefined;
  try {
    const member = (await database.query.users.findFirst({ where: eq(schema.users.steam64, f.steam64[1]!) }))!;
    const mergedId = member.id; const canonicalId = randomUUID(); const actorId = randomUUID();
    await database.insert(schema.users).values([{ id: canonicalId, email: `${canonicalId}@fixture.test` }, { id: actorId, email: `${actorId}@fixture.test`, role: "super_admin" }]);
    await database.update(schema.matches).set({ status: "finished", scoreA: 2, scoreB: 0, completedAt: new Date(), mvpWinnerUserId: mergedId }).where(eq(schema.matches.id, f.matchId));
    await database.insert(schema.betPrograms).values({ seasonId: f.seasonId });
    const [intent] = await database.insert(schema.dakPairingIntents).values({ pollTokenHash: randomUUID(), expiresAt: new Date(Date.now()+60000) }).returning();
    const [pairing] = await database.insert(schema.dakPairings).values({ pairingIntentId: intent!.id, userId: actorId, tokenHash: randomUUID(), scopes: ["demo:submit"], seasonIds: [f.seasonId] }).returning();
    const payload = JSON.parse(readFileSync("tests/fixtures/demo-evidence/normal-map-v1.json", "utf8"));
    payload.participants.forEach((p: { steamId64: string }, index: number) => { p.steamId64 = f.steam64[index]; });
    const [imported] = await database.insert(schema.matchDemoImports).values({ seasonId: f.seasonId, matchId: f.matchId, matchMapId: f.mapOneId, stageKey: "fixture-stage", demoSha256: "a".repeat(64), payloadSha256: "b".repeat(64), contractVersion: "rivalhub-demo-evidence/1", semanticProfile: "dak-stable/2", analysisVersion: "fixture", evidenceRevision: "fixture", status: "confirmed", payload, submittedByPairingId: pairing!.id }).returning();
    const alternate = testSteam64(randomUUID());
    const [identity] = await database.insert(schema.userGameplaySteamIds).values({ userId: mergedId, steam64: alternate, provenance: "admin_confirmed_alternate", sourceImportId: imported!.id, confirmedByUserId: actorId, confirmedAt: new Date(), reason: "isolated historical identity" }).returning();
    // A second immutable submitted artifact references the revocable alias.
    await database.insert(schema.matchDemoImports).values({ ...imported!, id: randomUUID(), payloadSha256: "c".repeat(64), payload: { ...payload, participants: payload.participants.map((p: { steamId64: string }, index: number) => index === 1 ? { ...p, steamId64: alternate } : p) } });
    // A confirmed historical artifact in a second event references the same
    // identity. Its scope must be fenced even though it is not the input page.
    const other = await seedFixture();
    await database.insert(schema.betPrograms).values({ seasonId: other.seasonId });
    await database.update(schema.matches).set({ mvpWinnerUserId: mergedId }).where(eq(schema.matches.id, other.matchId));
    const [otherImport] = await database.insert(schema.matchDemoImports).values({ ...imported!, id: randomUUID(), seasonId: other.seasonId, matchId: other.matchId, matchMapId: other.mapOneId, payloadSha256: "d".repeat(64), payload: { ...payload, participants: payload.participants.map((p: { steamId64: string }, index: number) => index === 1 ? { ...p, steamId64: alternate } : p) } }).returning();
    const contested = legacy ? f : other;
    const preflight = await buildUserMergePreflight(database, { canonicalUserId: canonicalId, mergedUserId: mergedId }, { evidenceClass: "super_admin_review" });
    expect(preflight.executable).toBe(true);
    await a.query("SET statement_timeout='5s'"); await b.query("SET statement_timeout='5s'");
    await b.query("BEGIN");
    await b.query("SELECT id FROM seasons WHERE id=$1 FOR UPDATE", [contested.seasonId]);
    await b.query("SELECT id FROM matches WHERE id=$1 FOR UPDATE", [contested.matchId]);
    const aPid = (await a.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const bPid = (await b.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const input = { canonicalUserId: canonicalId, mergedUserId: mergedId, actorUserId: actorId, expectedFingerprint: preflight.fingerprint, evidenceClass: "super_admin_review" as const, reason: "isolated lock-order fixture" };
    const retireInput = { identityId: identity!.id, seasonId: f.seasonId, actorId, reason: "isolated retirement fixture" };
    pending = database.transaction(async tx => {
      if (command === "merge") await executeUserMergeInTx(tx, input);
      else await retireSeasonGameplaySteamIdentityInTx(tx, retireInput);
    }).then(() => ({}), error => ({ code: error.cause?.code ?? error.code, message: error.message }));
    if (legacy || command === "retire") {
      let blocked = false; const deadline = performance.now()+3000;
      while (performance.now()<deadline) {
        const result = await observer.query("SELECT $2::integer=ANY(pg_blocking_pids($1::integer)) AS blocked", [aPid,bPid]);
        if (result.rows[0].blocked) { blocked=true; break; } await delay(10);
      }
      expect(blocked).toBe(true);
      const official = await b.query("UPDATE matches SET updated_at=clock_timestamp() WHERE id=$1", [contested.matchId])
        .then(() => ({} as { code?: string }), error => ({ code: error.code }));
      await b.query("ROLLBACK");
      const merge = await pending;
      if (legacy) expect([official.code,merge.code].filter(Boolean)).toEqual(["40P01"]);
      else {
        expect(official.code).toBeUndefined(); expect(merge.code).toBeUndefined();
        expect((await database.query.matchDemoImports.findFirst({ where: eq(schema.matchDemoImports.id, otherImport!.id) }))!.status).toBe("needs_attention");
        expect((await database.query.userGameplaySteamIds.findFirst({ where: eq(schema.userGameplaySteamIds.id, identity!.id) }))!.status).toBe("retired");
      }
    } else {
      const rejected = await pending;
      expect(rejected.message).toContain("本次归并未执行");
      expect((await database.query.matchDemoImports.findFirst({ where: eq(schema.matchDemoImports.id, imported!.id) }))!.status).toBe("confirmed");
      await b.query("UPDATE matches SET updated_at=clock_timestamp() WHERE id=$1", [contested.matchId]);
      await b.query("COMMIT");
      const fresh = await buildUserMergePreflight(database, { canonicalUserId: canonicalId, mergedUserId: mergedId }, { evidenceClass: "super_admin_review" });
      await database.transaction(tx => executeUserMergeInTx(tx, { ...input, expectedFingerprint: fresh.fingerprint }));
      expect((await database.query.matchDemoImports.findFirst({ where: eq(schema.matchDemoImports.id, imported!.id) }))!.status).toBe("needs_attention");
      expect((await database.query.matches.findFirst({ where: eq(schema.matches.id, f.matchId) }))!.mvpWinnerUserId).toBe(canonicalId);
    }
  } finally {
    await b.query("ROLLBACK"); if (pending) await pending;
    a.release(); b.release(); observer.release(); await pool.end(); revision.legacy=false;
  }
});
