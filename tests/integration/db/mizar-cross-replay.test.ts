import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { ingestMizarReliable } from "@/lib/mizar/reliable";
import { seedFixture, NOW } from "./harness/mizar";

const checkout = process.env.RIVALHUB_MIZAR_CHECKOUT;
describe.skipIf(!checkout)("Mizar real connection and RivalHub receiver", () => {
  it("replays two boundaries with their original lineups after the first end is delayed", async () => {
    const f = await seedFixture();
    const mapThreeId = randomUUID();
    await db.insert(schema.matchMaps).values({ id: mapThreeId, matchId: f.matchId, mapOrder: 3, mapName: "de_nuke" });
    const connectionUrl = pathToFileURL(resolve(checkout!, "apps/companion/src/match-context/rivalhub-connection.ts")).href;
    const outboxUrl = pathToFileURL(resolve(checkout!, "apps/companion/src/output/reliable-outbox.ts")).href;
    const { RivalHubConnection, OFFICIAL_RIVALHUB_URL } = await import(/* @vite-ignore */ connectionUrl);
    const { ReliableOutbox } = await import(/* @vite-ignore */ outboxUrl);
    const directory = await mkdtemp(join(tmpdir(), "rival-mizar-replay-"));
    try {
      const path = join(directory, "connection.json");
      await writeFile(path, JSON.stringify({ baseUrl: OFFICIAL_RIVALHUB_URL, credential: "test", installationId: f.installationId, competitionId: f.seasonId, displayName: "Test" }));
      let offline = false;
      const errors: string[] = [];
      const receiver: typeof fetch = async (url, init) => {
        const endpoint = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
        if (endpoint.endsWith("/claim")) return Response.json({ claimed: true, authorityRevision: f.authorityRevision });
        if (!endpoint.endsWith("/reliable")) return new Response(null, { status: 204 });
        if (offline) throw new Error("fixture offline");
        if (typeof init?.body !== "string") throw new Error("fixture missing body");
        const body = JSON.parse(init.body);
        try {
          await ingestMizarReliable(f.installationId, f.seasonId, body.event, f.authorityRevision, body.lineupSteam64);
          return new Response(null, { status: 204 });
        } catch (error) { errors.push(error instanceof Error ? error.message : "unknown"); return new Response(null, { status: 400 }); }
      };
      const connection = new RivalHubConnection(path, receiver);
      await connection.load();
      const cursor = { producerInstanceId: f.producerInstanceId, liveSessionId: f.liveSessionId, runtimeSeq: 1, programSourceGeneration: 0, programReceiveSequence: 1, mapEpoch: 1 };
      const initial = { matchId: f.matchId, competitionId: f.seasonId, cursor, players: f.steam64.map(sourcePlayerId => ({ sourcePlayerId, lineupEvidence: "current" })) };
      await connection.claim(initial, f.contextRevision, false);
      const current = { ...initial, cursor: { ...cursor, mapEpoch: 3, runtimeSeq: 7 } };
      const box = new ReliableOutbox(join(directory, "outbox.json"));
      const make = (kind: string, epoch: number, seq: number, mapId: string, mapName: string, payload: object) => ({ schemaVersion: "mizar.reliable-event.v1", idempotencyKey: randomUUID(), kind, cursor: { ...cursor, mapEpoch: epoch, runtimeSeq: seq, programReceiveSequence: seq }, observedAt: NOW.toISOString(), matchId: f.matchId, competitionId: f.seasonId, contextRevision: f.contextRevision, mapId, mapName, entryAId: f.entryAId, entryBId: f.entryBId, evidence: { identity: "matched", telemetryFresh: true, contextFresh: true, source: "runtime-transition" }, payload });
      const firstStart = make("map_started", 1, 1, f.mapOneId, "de_ancient", {});
      const endOne = make("map_ended", 1, 2, f.mapOneId, "de_ancient", { scoreA: 13, scoreB: 9, scoreCT: 13, scoreT: 9 });
      const epochTwo = make("map_epoch_changed", 2, 3, f.mapTwoId, "de_mirage", { previousMapEpoch: 1, reason: "next" });
      const startTwo = make("map_started", 2, 4, f.mapTwoId, "de_mirage", {});
      const endTwo = make("map_ended", 2, 5, f.mapTwoId, "de_mirage", { scoreA: 9, scoreB: 13, scoreCT: 9, scoreT: 13 });
      const epochThree = make("map_epoch_changed", 3, 6, mapThreeId, "de_nuke", { previousMapEpoch: 2, reason: "next" });
      const startThree = make("map_started", 3, 7, mapThreeId, "de_nuke", {});
      const sink = { send: (event: unknown, signal: AbortSignal, lineup: string[]) => connection.sendReliable(event, current, signal, lineup) };
      const at = NOW;
      await box.enqueue(firstStart, at, undefined, f.steam64);
      await box.flush({ sink, now: at, isCurrent: () => true });
      offline = true;
      for (const event of [endOne, epochTwo, startTwo, endTwo, epochThree, startThree]) await box.enqueue(event, at, undefined, event.kind === "map_started" ? f.steam64 : undefined);
      await box.flush({ sink, now: at, isCurrent: () => true });
      offline = false;
      await box.flush({ sink, now: new Date(at.getTime() + 2000), isCurrent: () => true });
      expect(errors).toEqual([]);
      expect(box.getRecords().filter((r: { status: string }) => r.status === "accepted")).toHaveLength(7);
      const [source] = await db.select().from(schema.matchLiveSessions).where(eq(schema.matchLiveSessions.id, f.sessionId));
      expect(source).toMatchObject({ mapEpoch: 3, currentMapId: mapThreeId, lastReliableSeq: 7 });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
