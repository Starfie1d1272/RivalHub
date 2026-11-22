// Runs in a Node child with react-server conditions. All HTTP uses the real
// current Mizar client; only game observations and local fixture identities are synthetic.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { disposeDatabaseBinding } from "@/db/client-runtime";
import * as schema from "@/db/schema";
import { hashCredential } from "@/lib/mizar/installation";
import type { LiveSnapshotV1 } from "@/lib/mizar/protocol";
import { assertLocalDatabaseUrl } from "../../../scripts/db/local-environment";
import { seedFixture } from "../../integration/db/harness/mizar";
import { mizarSnapshot } from "../../integration/db/harness/mizar-snapshot";

async function main() {
  assertLocalDatabaseUrl(process.env.DATABASE_URL, "Mizar browser fixture");
  const baseUrl = process.argv[2]!;
  assert(["localhost", "127.0.0.1"].includes(new URL(baseUrl).hostname));
  assert(process.env.RIVALHUB_MIZAR_CHECKOUT, "Current Mizar checkout is required");
  const { RivalHubConnection } = await import(pathToFileURL(resolve(process.env.RIVALHUB_MIZAR_CHECKOUT, "apps/companion/src/match-context/rivalhub-connection.ts")).href);
  const { OutputService } = await import(pathToFileURL(resolve(process.env.RIVALHUB_MIZAR_CHECKOUT, "apps/companion/src/output/service.ts")).href);
  const { ReliableOutbox } = await import(pathToFileURL(resolve(process.env.RIVALHUB_MIZAR_CHECKOUT, "apps/companion/src/output/reliable-outbox.ts")).href);
  const directory = await mkdtemp(join(tmpdir(), "rivalhub-mizar-browser-"));
  const f = await seedFixture({ unboundSource: true });
  const lateJoin = process.argv[3] === "late";
  const mapId = lateJoin ? f.mapTwoId : f.mapOneId;
  const mapName = lateJoin ? "de_mirage" : "de_ancient";
  const mapOrder = lateJoin ? 2 : 1;
  await db.delete(schema.matchLiveSessions).where(eq(schema.matchLiveSessions.id, f.sessionId));
  const clients: InstanceType<typeof RivalHubConnection>[] = [];
  const outputs: InstanceType<typeof OutputService>[] = [];
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> = Promise.resolve();
  let uploadError: unknown;
  let score = 3;
  let sequence = 10;
  let accepted = 0;
  let revision = "";
  const snapshot = () => {
    const frame: LiveSnapshotV1 = mizarSnapshot(f, ++sequence);
    frame.map = { ...frame.map, name: mapName, mapId, scoreCT: score, scoreT: 2, roundNumber: score + 3 };
    frame.series.currentMapOrder = mapOrder;
    if (lateJoin) { frame.series.scoreA = null; frame.series.scoreB = null; }
    frame.players = frame.players.map((p, i) => ({ ...p, sourcePlayerId: f.steam64[i]!, canonicalPlayerId: f.fixtureUserIds[i]! }));
    frame.radar = null;
    frame.capability.radarCurrent = false;
    frame.roundHistory = null;
    return frame;
  };
  const event = (kind: "map_started" | "map_ended") => ({
    schemaVersion: "mizar.reliable-event.v1", idempotencyKey: randomUUID(), kind,
    cursor: snapshot().cursor, observedAt: new Date().toISOString(), matchId: f.matchId,
    competitionId: f.seasonId, contextRevision: revision, mapId, mapName,
    entryAId: f.entryAId, entryBId: f.entryBId,
    evidence: { identity: "matched", telemetryFresh: true, contextFresh: true, source: "runtime-transition" },
    payload: kind === "map_started" ? {} : { scoreA: 13, scoreB: 9, scoreCT: 13, scoreT: 9 },
  });
  const stop = async () => { running = false; clearTimeout(timer); timer = undefined; await pending; };
  const pump = () => {
    running = true;
    pending = clients[0].sendLive(snapshot()).catch((error: unknown) => { uploadError = error; });
    void pending.then(() => { if (running) timer = setTimeout(pump, 550); });
  };
  try {
    for (const [index, installationId] of [f.installationId, f.installationBId].entries()) {
      const credential = `rh_mizar_${installationId}_${randomBytes(32).toString("hex")}`;
      await db.update(schema.mizarInstallations).set({ credentialHash: hashCredential(credential) }).where(eq(schema.mizarInstallations.id, installationId));
      const path = join(directory, String(index), "connection.json");
      await mkdir(join(directory, String(index)));
      await writeFile(path, JSON.stringify({ baseUrl, credential, installationId, competitionId: f.seasonId, displayName: `Commentator ${index + 1}` }));
      const transport: typeof fetch = async (url, init) => {
        const response = await fetch(url, init);
        if (String(url).endsWith("/live") && response.ok && (await response.clone().json()).accepted) accepted++;
        return response;
      };
      const client = new RivalHubConnection(path, transport, baseUrl);
      clients.push(client);
      await client.load();
      // The connection requires its actual output owner to prove a settled
      // capture before release, even when these fixture events are sent directly.
      const output = new OutputService({ outbox: new ReliableOutbox(join(directory, String(index), "outbox.json")) });
      outputs.push(output);
      await output.start();
      await client.setSourceCaptureLifecycle({
        createReference: (cursor: LiveSnapshotV1["cursor"]) => output.createCaptureReference(cursor),
        arm: (...args: unknown[]) => output.armSourceCapture(...args),
        activate: (...args: unknown[]) => output.activateSourceCapture(...args),
        restore: (...args: unknown[]) => output.restoreSourceCapture(...args),
        seal: (...args: unknown[]) => output.sealSourceCapture(...args),
        coverage: (...args: unknown[]) => output.sourceCaptureCoverage(...args),
      });
      client.setSourceSettlement((...args: unknown[]) => output.settleSourceForRelease(...args), (...args: unknown[]) => output.resumeSource(...args));
    }
    const commands: Record<string, () => Promise<unknown>> = {
      async start() {
        const manifest = await clients[0].matchSource(f.matchId).load();
        revision = manifest.revision;
        const frame = snapshot();
        const binding = { origin: "online", freshness: "fresh", manifest, context: {
          matchId: f.matchId, competition: { competitionId: f.seasonId },
          entrants: { a: { entryId: f.entryAId }, b: { entryId: f.entryBId } },
        } };
        for (const output of outputs) output.setCurrent({
          program: { cursor: frame.cursor, match: { matchId: f.matchId },
            status: { context: "fresh", telemetry: "fresh", identity: "matched" },
            map: { phase: "live", name: mapName }, players: frame.players,
            series: { status: "live", currentMapOrder: mapOrder, maps: [] } },
          operator: { activeLineup: { ctCount: 5, tCount: 5 }, identity: { state: "ok" } },
          identity: { issues: [] },
        }, binding);
        await clients[0].claimAutomatically(snapshot(), revision, () => true);
        assert.equal(clients[0].view().activeSourceMatchId, f.matchId);
        await clients[1].claimAutomatically(snapshot(), revision, () => true);
        assert.equal(clients[1].view().activeSourceMatchId, null, "Second commentator must not steal authority");
        const start = event("map_started");
        assert.equal(await clients[0].sendReliable(start, snapshot(), undefined, f.steam64), "accepted");
        pump();
        return { matchId: f.matchId };
      },
      async score() { score = 4; return true; },
      async pause() { await stop(); return true; },
      async resume() { pump(); return true; },
      async finish() {
        await stop();
        if (uploadError) throw uploadError;
        assert(accepted > 1, "Server must accept live frames, not just return HTTP 200");
        assert.equal(await clients[0].sendReliable(event("map_ended"), snapshot()), "accepted");
        const [map] = await db.select().from(schema.matchMaps).where(eq(schema.matchMaps.id, mapId));
        assert.equal(map.scoreA, 13); assert.equal(map.scoreB, 9);
        if (lateJoin) {
          const [first] = await db.select().from(schema.matchMaps).where(eq(schema.matchMaps.id, f.mapOneId));
          assert.equal(first.scoreA, null); assert.equal(first.scoreB, null); assert.equal(first.completedAt, null);
        }
        await clients[0].release();
        const sessions = await db.select().from(schema.matchLiveSessions).where(eq(schema.matchLiveSessions.matchId, f.matchId));
        assert.equal(sessions.filter(s => s.closedAt === null).length, 0);
        return { accepted, scoreA: map.scoreA, scoreB: map.scoreB };
      },
    };
    process.send?.({ ready: true, matchId: f.matchId, slug: f.seasonId });
    await new Promise<void>(done => {
      let queue = Promise.resolve();
      process.on("message", (message: { id: number; command: string }) => {
        queue = queue.then(async () => {
          if (message.command === "close") { done(); return; }
          try { process.send?.({ id: message.id, result: await commands[message.command]!() }); }
          catch (error) { process.send?.({ id: message.id, error: String(error) }); }
        });
      });
      process.once("disconnect", done);
    });
  } finally {
    await stop();
    for (const client of clients) await client.abortSourceCaptureStartup();
    for (const output of outputs) await output.close();
    // Same local-only fixture cleanup policy as major-browser-fixture. Every
    // statement is scoped to this generated competition; never a remote DB.
    await db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL session_replication_role = replica`);
      const match = sql`SELECT id FROM matches WHERE season_id = ${f.seasonId}`;
      const entries = sql`SELECT id FROM competition_entries WHERE competition_id = ${f.seasonId}`;
      for (const table of ["mizar_reliable_receipts"]) await tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE session_id IN (SELECT id FROM match_live_sessions WHERE match_id IN (${match}))`);
      await tx.execute(sql`DELETE FROM match_roster_players WHERE roster_id IN (SELECT id FROM match_rosters WHERE match_id IN (${match}))`);
      for (const table of ["match_live_sessions", "match_veto_sessions", "match_rosters", "match_maps"]) await tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE match_id IN (${match})`);
      await tx.delete(schema.matches).where(eq(schema.matches.seasonId, f.seasonId));
      await tx.delete(schema.auditLogs).where(eq(schema.auditLogs.seasonId, f.seasonId));
      await tx.delete(schema.mizarInstallations).where(eq(schema.mizarInstallations.competitionId, f.seasonId));
      await tx.delete(schema.mizarPairingIntents).where(eq(schema.mizarPairingIntents.competitionId, f.seasonId));
      await tx.execute(sql`DELETE FROM competition_entry_roster_members WHERE revision_id IN (SELECT id FROM competition_entry_roster_revisions WHERE entry_id IN (${entries}))`);
      await tx.execute(sql`DELETE FROM event_roster_members WHERE event_roster_id IN (SELECT id FROM event_rosters WHERE entry_id IN (${entries}))`);
      for (const table of ["event_rosters", "competition_entry_roster_revisions", "competition_entry_participants", "competition_entry_representative_changes"]) await tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE entry_id IN (${entries})`);
      await tx.delete(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, f.seasonId));
      await tx.delete(schema.seasons).where(eq(schema.seasons.id, f.seasonId));
      for (const id of f.fixtureUserIds) await tx.delete(schema.users).where(eq(schema.users.id, id));
    });
    await disposeDatabaseBinding();
    await rm(directory, { recursive: true, force: true });
  }
}
main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
