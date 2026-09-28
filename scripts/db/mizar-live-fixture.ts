/** Disposable Local Supabase evidence, never a production entrypoint. */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import { db } from "../../src/db/client";
import * as schema from "../../src/db/schema";
import { ingestMizarLive, issueLiveViewerToken, matchLiveTopic } from "../../src/lib/mizar/live";
import { loadMizarMatchDocumentInTx } from "../../src/lib/mizar/context";
import { claimMizarSource } from "../../src/lib/mizar/source";
import { assertDeclaredDatabaseTarget, assertLocalHttpUrl } from "./local-environment";

assertDeclaredDatabaseTarget(process.env);
if (process.env.RIVALHUB_DB_TARGET !== "local") throw new Error("Live evidence requires local target");
const apiUrl = assertLocalHttpUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, "Supabase URL");
const command = process.argv[2];
const seasonId = process.argv[3] ?? randomUUID();

async function create() {
  const userId = randomUUID(), entryA = randomUUID(), entryB = randomUUID();
  const matchId = randomUUID(), otherMatchId = randomUUID(), mapId = randomUUID();
  const installationId = randomUUID();
  await db.transaction(async tx => {
    await tx.insert(schema.users).values({ id: userId, email: `${userId}@live.local` });
    await tx.insert(schema.seasons).values({ id: seasonId, slug: seasonId, name: "Live transport evidence", kind: "custom", status: "playing" });
    for (const [id, name] of [[entryA, "Live Team A"], [entryB, "Live Team B"]]) {
      const revisionId = randomUUID();
      await tx.insert(schema.competitionEntries).values({ id, competitionId: seasonId, source: "event_native", name, representativeUserId: userId, currentRosterRevisionId: revisionId, reviewReason: "private-review-marker", perfectTeamId: "private-perfect-marker" });
      await tx.insert(schema.competitionEntryRosterRevisions).values({ id: revisionId, entryId: id, revisionNumber: 1, createdBy: userId });
      await tx.insert(schema.competitionEntryRepresentativeChanges).values({ entryId: id, fromUserId: null, toUserId: userId, changedByActorId: "live-transport-fixture" });
    }
    await tx.insert(schema.matches).values([matchId, otherMatchId].map(id => ({ id, seasonId, entryAId: entryA, entryBId: entryB, stage: "test", format: "bo3" as const, status: "in_progress" as const, startedAt: new Date() })));
    await tx.insert(schema.matchMaps).values({ id: mapId, matchId, mapOrder: 1, mapName: "de_nuke" });
    await tx.insert(schema.matchVetoSessions).values({ matchId, startedAt: new Date(), completedAt: new Date() });
    await tx.insert(schema.mizarInstallations).values({ id: installationId, competitionId: seasonId, displayName: "Transport fixture", credentialHash: randomUUID() });
    await tx.insert(schema.matchLiveSessions).values({ matchId, installationId, producerInstanceId: "fixture-producer", liveSessionId: "fixture-live", authorityRevision: 1, mapEpoch: 1, programSourceGeneration: 0, contextRevision: "fixture", identityHealth: "healthy", lineupHealth: "healthy", continuityHealth: "healthy", currentMapId: mapId, mapExecutionPhase: "gameplay" });
  });
  return { seasonId, matchId, otherMatchId, installationId, mapId };
}

async function binding() {
  const [joined] = await db.select({ match: schema.matches }).from(schema.matches).innerJoin(schema.matchLiveSessions, eq(schema.matches.id, schema.matchLiveSessions.matchId)).where(eq(schema.matches.seasonId, seasonId));
  const match = joined.match;
  const [source] = await db.select().from(schema.matchLiveSessions).where(eq(schema.matchLiveSessions.matchId, match.id)).orderBy(sql`${schema.matchLiveSessions.authorityRevision} desc`);
  return { match, source };
}
async function publish(authorityRevision: number, score: number) {
  const { match, source } = await binding();
  const fixture = JSON.parse(readFileSync("tests/fixtures/contracts/mizar-live-snapshot-v1.radar.json", "utf8"));
  fixture.matchId = match.id; fixture.competitionId = seasonId;
  fixture.cursor.liveSessionId = source.liveSessionId;
  fixture.cursor.producerInstanceId = source.producerInstanceId;
  fixture.cursor.runtimeSeq = score + 1;
  fixture.capability.lineupComplete = true;
  fixture.map.mapId = source.currentMapId;
  fixture.map.scoreCT = score;
  fixture.teams.ct.entryId = match.entryAId; fixture.teams.t.entryId = match.entryBId;
  return ingestMizarLive(source.installationId, seasonId, fixture, authorityRevision);
}
async function handover() {
  const { match } = await binding();
  const installationId = randomUUID();
  await db.insert(schema.mizarInstallations).values({ id: installationId, competitionId: seasonId, displayName: "Replacement", credentialHash: randomUUID() });
  const context = await db.transaction(tx => loadMizarMatchDocumentInTx(tx, match.id, seasonId));
  const result = await claimMizarSource(installationId, seasonId, { matchId: match.id, producerInstanceId: "new-producer", liveSessionId: "new-live", programSourceGeneration: 0, mapEpoch: 1, contextRevision: context.revision, takeover: true, lineupSteam64: [] });
  // Fixture represents the producer's successful identity/lineup handshake.
  await db.update(schema.matchLiveSessions).set({ identityHealth: "healthy", lineupHealth: "healthy", currentMapId: (await db.select().from(schema.matchMaps).where(eq(schema.matchMaps.matchId, match.id)))[0].id, mapExecutionPhase: "gameplay" })
    .where(and(eq(schema.matchLiveSessions.installationId, installationId), eq(schema.matchLiveSessions.matchId, match.id)));
  return result;
}
async function cleanup() {
  await db.transaction(async tx => {
    const entries = await tx.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, seasonId));
    await tx.execute(sql`SET LOCAL session_replication_role = replica`);
    await tx.execute(sql`DELETE FROM match_live_sessions WHERE match_id IN (SELECT id FROM matches WHERE season_id = ${seasonId})`);
    await tx.execute(sql`DELETE FROM match_veto_sessions WHERE match_id IN (SELECT id FROM matches WHERE season_id = ${seasonId})`);
    await tx.execute(sql`DELETE FROM match_maps WHERE match_id IN (SELECT id FROM matches WHERE season_id = ${seasonId})`);
    await tx.delete(schema.matches).where(eq(schema.matches.seasonId, seasonId));
    await tx.delete(schema.auditLogs).where(eq(schema.auditLogs.seasonId, seasonId));
    await tx.delete(schema.mizarInstallations).where(eq(schema.mizarInstallations.competitionId, seasonId));
    await tx.execute(sql`DELETE FROM competition_entry_representative_changes WHERE entry_id IN (SELECT id FROM competition_entries WHERE competition_id = ${seasonId})`);
    await tx.execute(sql`DELETE FROM competition_entry_roster_revisions WHERE entry_id IN (SELECT id FROM competition_entries WHERE competition_id = ${seasonId})`);
    await tx.delete(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, seasonId));
    await tx.delete(schema.seasons).where(eq(schema.seasons.id, seasonId));
    for (const userId of new Set(entries.map(row => row.representativeUserId))) await tx.delete(schema.users).where(eq(schema.users.id, userId));
  });
}

function subscribed(channel: RealtimeChannel, denied = false) {
  return new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error("Realtime subscription deadline")), 12_000);
    channel.subscribe(status => {
      if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(deadline);
        if ((status === "SUBSCRIBED") === !denied) resolve();
        else reject(new Error(`Unexpected subscription status: ${status}`));
      }
    });
  });
}
async function verify() {
  const ids = await create();
  const document = await db.transaction(tx => loadMizarMatchDocumentInTx(tx, ids.matchId, seasonId));
  const publicJson = JSON.stringify(document);
  if (["private-review-marker", "private-perfect-marker", "@live.local", "credentialHash", "installationId"].some(value => publicJson.includes(value))) throw new Error("Provider DTO leaked private facts");
  const credential = await issueLiveViewerToken(ids.matchId);
  const viewer = createClient(apiUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { accessToken: async () => credential.token });
  const channel = viewer.channel(credential.topic, { config: { private: true, broadcast: { ack: true } } });
  try {
    const received = new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error("No service broadcast received")), 12_000);
      channel.on("broadcast", { event: "snapshot" }, ({ payload }) => { if (payload.matchId === ids.matchId) { clearTimeout(deadline); resolve(); } });
    });
    await subscribed(channel);
    if (!(await publish(1, 7)).accepted) throw new Error("Service broadcast rejected");
    await received;
    await subscribed(viewer.channel(matchLiveTopic(ids.otherMatchId), { config: { private: true } }), true);
    await viewer.realtime.setAuth();
    const httpWrite = await channel.httpSend("snapshot", { forged: true });
    if (httpWrite.success) throw new Error("Viewer HTTP write was authorized");
    if (await channel.send({ type: "broadcast", event: "snapshot", payload: { forged: true } }) === "ok") throw new Error("Viewer WebSocket write was authorized");
    console.log("Live transport: actual viewer JWT / private subscription / service HTTP Broadcast / cross-match denial / viewer write denial passed");
  } finally { await viewer.removeAllChannels(); await cleanup(); }
}

async function main() {
  try {
    let result: unknown;
    if (command === "create") result = await create();
    else if (command === "publish") {
      try { result = await publish(Number(process.argv[4]), Number(process.argv[5])); }
      catch (error) { if (error instanceof Error && "code" in error && error.code === "FORBIDDEN") result = { rejected: true }; else throw error; }
    } else if (command === "handover") result = await handover();
    else if (command === "cleanup") await cleanup();
    else if (command === "verify") await verify();
    else throw new Error("Unknown live fixture command");
    if (result) console.log(`LIVE_FIXTURE ${JSON.stringify(result)}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Live evidence failed");
    process.exitCode = 1;
  }
}
void main();
