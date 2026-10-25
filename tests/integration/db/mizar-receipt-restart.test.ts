import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { releaseMizarSource } from "@/lib/mizar/source";
import { RELIABLE_EVENT_SCHEMA_VERSION } from "@/lib/mizar/protocol";
import { seedFixture, NOW } from "./harness/mizar";

it("recovers the durable receipt after SIGKILL loses the response, then releases a finished source", async () => {
  const f = await seedFixture();
  // A single canonical map finishes this isolated series.
  await db.update(schema.matches).set({ format: "bo1" }).where(eq(schema.matches.id, f.matchId));
  await db.delete(schema.matchMaps).where(eq(schema.matchMaps.id, f.mapTwoId));
  const event = {
    schemaVersion: RELIABLE_EVENT_SCHEMA_VERSION, idempotencyKey: `restart-${randomUUID()}`,
    cursor: { producerInstanceId: f.producerInstanceId, liveSessionId: f.liveSessionId, runtimeSeq: 1, programSourceGeneration: 0, programReceiveSequence: 1, mapEpoch: 1 },
    observedAt: NOW.toISOString(), matchId: f.matchId, competitionId: f.seasonId, contextRevision: f.contextRevision,
    mapId: f.mapOneId, mapName: "de_ancient", entryAId: f.entryAId, entryBId: f.entryBId,
    evidence: { identity: "matched", telemetryFresh: true, contextFresh: true, source: "runtime-transition" },
    kind: "map_ended", payload: { scoreA: 13, scoreB: 9, scoreCT: 4, scoreT: 9 },
  };
  const children: ChildProcess[] = [];
  const invoke = async () => {
    const child = fork("tests/integration/db/harness/mizar-receipt-child.ts", [], {
      execPath: process.execPath, execArgv: ["--conditions=react-server", "--import", "tsx"],
      env: { ...process.env, NODE_ENV: "test" }, stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    children.push(child);
    let diagnostics = "";
    child.stderr?.on("data", value => { diagnostics = (diagnostics + String(value)).slice(-2000); });
    const response = once(child, "message");
    const failed = once(child, "exit").then(([code, signal]) => { throw new Error(`receipt child exited ${code}/${signal}: ${diagnostics}`); });
    child.send({ installationId: f.installationId, seasonId: f.seasonId, event, revision: f.authorityRevision });
    return { child, result: (await Promise.race([response, failed]))[0] };
  };
  try {
    const original = await invoke();
    expect(original.result).toEqual({ receipt: { outcome: "canonicalized", duplicate: false } });
    const stopped = once(original.child, "exit");
    original.child.kill("SIGKILL");
    expect(await stopped).toEqual([null, "SIGKILL"]);
    // New application process reads the persisted receipt before sequence/revision handling.
    expect((await invoke()).result).toEqual({ receipt: { outcome: "canonicalized", duplicate: true } });
    const [match] = await db.select().from(schema.matches).where(eq(schema.matches.id, f.matchId));
    expect(match).toMatchObject({ status: "finished", scoreA: 1, scoreB: 0 });
    const [source] = await db.select().from(schema.matchLiveSessions).where(eq(schema.matchLiveSessions.id, f.sessionId));
    expect(source).toMatchObject({ mapExecutionPhase: "inter_map", closedAt: null, lastReliableSeq: 1 });
    expect(await db.select().from(schema.mizarReliableReceipts).where(eq(schema.mizarReliableReceipts.sessionId, f.sessionId))).toHaveLength(1);
    expect(await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.targetId, f.matchId), eq(schema.auditLogs.action, "match.record_map_result")))).toHaveLength(1);
    const release = () => releaseMizarSource(f.installationId, f.seasonId, {
      matchId: f.matchId, producerInstanceId: f.producerInstanceId, liveSessionId: f.liveSessionId,
    }, f.authorityRevision);
    await release();
    await release();
    expect((await db.select().from(schema.matchLiveSessions).where(eq(schema.matchLiveSessions.id, f.sessionId)))[0]).toMatchObject({ closeReason: "released", autoCanonicalizationArmed: false });
    expect(await db.select().from(schema.mizarReliableReceipts).where(eq(schema.mizarReliableReceipts.sessionId, f.sessionId))).toHaveLength(1);
  } finally {
    await Promise.all(children.filter(child => child.exitCode === null && child.signalCode === null).map(async child => {
      const stopped = once(child, "exit"); child.kill("SIGKILL"); await stopped;
    }));
  }
});
