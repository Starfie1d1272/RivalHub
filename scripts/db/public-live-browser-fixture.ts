/** Local browser evidence: real captured Mizar output through the production ingest/projection. */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../src/db/client";
import { matches, matchMaps, matchLiveSessions, matchVetoSessions, competitionEntries, seasons } from "../../src/db/schema";
import { ingestMizarLive } from "../../src/lib/mizar/live";
import { parseLiveSnapshotV1 } from "../../src/lib/mizar/protocol";
import { assertDeclaredDatabaseTarget } from "./local-environment";
async function main() {
assertDeclaredDatabaseTarget(process.env);
if (process.env.RIVALHUB_DB_TARGET !== "local") throw new Error("Local browser evidence only");
const [command, matchId, phase] = process.argv.slice(2);
const match = await db.query.matches.findFirst({ where: eq(matches.id, matchId) });
if (!match) throw new Error("Missing local fixture match");
const source = await db.query.matchLiveSessions.findFirst({ where: and(eq(matchLiveSessions.matchId, matchId), isNull(matchLiveSessions.closedAt)) });
if (!source) throw new Error("Missing local fixture source");
const original = JSON.parse(readFileSync("tests/fixtures/contracts/mizar-live-real-derived.json", "utf8")).snapshot;
async function ensureMaps() {
  const existing = await db.query.matchMaps.findMany({ where: eq(matchMaps.matchId, matchId) });
  if (!existing.some(map => map.mapOrder === 1)) await db.insert(matchMaps).values({ id: source!.currentMapId!, matchId, mapOrder: 1, mapName: original.map.name });
  for (const [mapOrder, mapName] of [[2, "de_nuke"], [3, "de_mirage"]] as const) {
    if (!existing.some(map => map.mapOrder === mapOrder)) await db.insert(matchMaps).values({ id: randomUUID(), matchId, mapOrder, mapName });
  }
}
if (command === "prepare") {
  await ensureMaps();
  await db.update(seasons).set({ stagePlan: [{ key: "test", name: "比赛", type: "round_robin", teamCount: 2, advanceTiers: [], matchFormat: "bo3" }] }).where(eq(seasons.id, match.seasonId));
  await db.update(matchMaps).set({ mapName: original.map.name }).where(eq(matchMaps.id, source.currentMapId!));
  await db.update(competitionEntries).set({ name: original.teams.ct.name }).where(eq(competitionEntries.id, match.entryAId));
  await db.update(competitionEntries).set({ name: original.teams.t.name }).where(eq(competitionEntries.id, match.entryBId));
} else if (command === "switch-map") {
  await db.update(matchMaps).set({ scoreA: 13, scoreB: 9, completedAt: new Date() }).where(eq(matchMaps.id, source.currentMapId!));
  const next = await db.query.matchMaps.findFirst({ where: and(eq(matchMaps.matchId, matchId), eq(matchMaps.mapOrder, 2)) });
  if (!next) throw new Error("Missing next map");
  await db.update(matchLiveSessions).set({ currentMapId: next.id, mapEpoch: source.mapEpoch + 1, mapExecutionPhase: "gameplay" }).where(eq(matchLiveSessions.id, source.id));
} else if (command === "stream") {
  const currentMap = await db.query.matchMaps.findFirst({ where: eq(matchMaps.id, source.currentMapId!) });
  const wireFixture = currentMap?.mapName === "de_nuke"
    ? JSON.parse(readFileSync("tests/fixtures/contracts/mizar-live-snapshot-v1.radar.json", "utf8")) : original;
  let sequence = Date.now();
  let ready = false;
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const snapshot = structuredClone(wireFixture);
    snapshot.series.currentMapOrder = currentMap!.mapOrder;
    if (snapshot.roundHistory) snapshot.roundHistory.mapOrder = currentMap!.mapOrder;
    snapshot.matchId = match.id; snapshot.competitionId = match.seasonId;
    snapshot.producedAt = new Date().toISOString();
    snapshot.cursor = { ...snapshot.cursor, producerInstanceId: source.producerInstanceId, liveSessionId: source.liveSessionId, programSourceGeneration: source.programSourceGeneration, mapEpoch: source.mapEpoch, runtimeSeq: sequence++ };
    snapshot.map.mapId = source.currentMapId;
    snapshot.teams.ct.entryId = match.entryAId; snapshot.teams.t.entryId = match.entryBId;
    snapshot.capability.lineupComplete = true;
    for (const player of snapshot.players) player.canonicalPlayerId = null;
    const result = await ingestMizarLive(source.installationId, match.seasonId, parseLiveSnapshotV1(snapshot), source.authorityRevision);
    if (!result.accepted) throw new Error("Local Broadcast rejected");
    if (!ready) { console.log("PUBLIC_LIVE_READY"); ready = true; }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
} else if (command === "phase") {
  if (!["pre", "bp", "waiting", "gameplay", "inter_map", "post"].includes(phase)) throw new Error("Unknown phase");
  if (phase === "pre") await db.delete(matchMaps).where(eq(matchMaps.matchId, matchId));
  else if (phase !== "bp") await ensureMaps();
  await db.update(matches).set({ status: phase === "post" ? "finished" : phase === "pre" ? "scheduled" : "in_progress", scoreA: phase === "post" ? 2 : null, scoreB: phase === "post" ? 0 : null, completedAt: phase === "post" ? new Date() : null }).where(eq(matches.id, match.id));
  await db.update(matchVetoSessions).set({ startedAt: phase === "pre" ? null : new Date(), completedAt: ["pre", "bp"].includes(phase) ? null : new Date() }).where(eq(matchVetoSessions.matchId, match.id));
  await db.update(matchLiveSessions).set({ mapExecutionPhase: phase === "gameplay" ? "gameplay" : "waiting" }).where(eq(matchLiveSessions.id, source.id));
  await db.update(matchMaps).set({ completedAt: ["inter_map", "post"].includes(phase) ? new Date() : null, scoreA: ["inter_map", "post"].includes(phase) ? 13 : null, scoreB: ["inter_map", "post"].includes(phase) ? 9 : null }).where(eq(matchMaps.id, source.currentMapId!));
  if (phase === "post") await db.update(matchMaps).set({ completedAt: new Date(), scoreA: 13, scoreB: 9 }).where(and(eq(matchMaps.matchId, matchId), eq(matchMaps.mapOrder, 2)));
} else throw new Error("Unknown command");
process.exit(0);
}
void main().catch(error => {
  console.error(error instanceof Error ? error.message : "Local public viewer fixture failed");
  process.exit(1);
});
