import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { expect, it } from "vitest";
import * as schema from "@/db/schema";
import { revokeMizarInstallationInTx } from "@/lib/mizar/installation";
import { writeAuditInTx } from "@/lib/audit/write";
import { createLocalPool } from "./harness/database";
import { seedFixture } from "./harness/mizar";

it.each(["legacy", "season-first"] as const)("revoke versus manual source lock barrier: %s", async mode => {
  const f = await seedFixture();
  const pool = createLocalPool({ max: 3 });
  const a = await pool.connect(); const b = await pool.connect(); const observer = await pool.connect();
  const database = drizzle(a, { schema });
  let pending: Promise<{ code?: string; revoked?: boolean }> | undefined;
  try {
    // Additional sources prove revocation retains complete installation scope.
    const source = (await database.query.matchLiveSessions.findFirst({ where: eq(schema.matchLiveSessions.id, f.sessionId) }))!;
    const extraIds: string[] = [];
    for (const installationId of [f.installationId, f.installationBId]) {
      const matchId = randomUUID(); const sessionId = randomUUID(); extraIds.push(sessionId);
      await database.insert(schema.matches).values({ id: matchId, seasonId: f.seasonId, entryAId: f.entryAId, entryBId: f.entryBId, stage: "fixture-stage", format: "bo3", status: "in_progress" });
      await database.insert(schema.matchLiveSessions).values({ ...source, id: sessionId, matchId, installationId, currentMapId: null, liveSessionId: randomUUID() });
    }
    await a.query("SET statement_timeout = '5s'"); await b.query("SET statement_timeout = '5s'");
    await b.query("BEGIN");
    // These are manual takeover/result's existing season → match acquisitions.
    await b.query("SELECT id FROM seasons WHERE id=$1 FOR UPDATE", [f.seasonId]);
    await b.query("SELECT id FROM matches WHERE id=$1 FOR UPDATE", [f.matchId]);
    const aPid = (await a.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const bPid = (await b.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    pending = database.transaction(async tx => {
      if (mode === "season-first") return revokeMizarInstallationInTx(tx, f.installationId, f.seasonId, f.installationId);
      await tx.select().from(schema.mizarInstallations).where(eq(schema.mizarInstallations.id, f.installationId)).for("update");
      await tx.update(schema.matchLiveSessions).set({ closedAt: new Date(), closeReason: "revoked", autoCanonicalizationArmed: false }).where(eq(schema.matchLiveSessions.installationId, f.installationId));
      // Real FK acquisition, not a stand-in SELECT of the season.
      await writeAuditInTx(tx, { seasonId: f.seasonId, actorId: "fixture", action: "mizar.installation.revoke", targetId: f.installationId });
      return { revoked: true };
    }).catch(error => ({ code: error.cause?.code ?? error.code }));
    let blocked = false;
    const deadline = performance.now() + 3000;
    while (performance.now() < deadline) {
      const result = await observer.query("SELECT $2::integer = ANY(pg_blocking_pids($1::integer)) AS blocked", [aPid, bPid]);
      if (result.rows[0].blocked) { blocked = true; break; }
      await delay(10);
    }
    expect(blocked).toBe(true);
    const manual = await b.query("SELECT id FROM match_live_sessions WHERE id=$1 FOR UPDATE", [f.sessionId])
      .then(() => ({} as { code?: string }), error => ({ code: error.code }));
    await b.query("ROLLBACK");
    const revoke = await pending;
    if (mode === "legacy") expect([manual.code, revoke.code].filter(Boolean)).toEqual(["40P01"]);
    else {
      expect(manual.code).toBeUndefined(); expect(revoke).toMatchObject({ revoked: true });
      const rows = await database.select().from(schema.matchLiveSessions);
      expect(rows.find(row => row.id === f.sessionId)).toMatchObject({ closeReason: "revoked", autoCanonicalizationArmed: false });
      expect(rows.find(row => row.id === extraIds[0])).toMatchObject({ closeReason: "revoked", autoCanonicalizationArmed: false });
      expect(rows.find(row => row.id === extraIds[1])!.closedAt).toBeNull();
      expect((await database.query.mizarInstallations.findFirst({ where: eq(schema.mizarInstallations.id, f.installationId) }))!.revokedAt).not.toBeNull();
    }
  } finally {
    await b.query("ROLLBACK"); if (pending) await pending;
    a.release(); b.release(); observer.release(); await pool.end();
  }
});
