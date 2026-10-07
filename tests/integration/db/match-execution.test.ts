import { seedFixture } from "./harness/mizar";
import resultFixture from "../../fixtures/contracts/independent-result-v2.json";
import { loadUnassociatedMizarDocumentInTx } from "../../../src/lib/mizar/context";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import { localDatabaseUrl } from "./harness/database";
import { createUnassociatedMatchInTx } from "../../../src/lib/matches/creation";
import { applyMatchStatusTransitionInTx } from "../../../src/lib/matches/lifecycle";
import { concludeUnassociatedMatchInTx, supplementUnassociatedResultInTx, correctUnassociatedResultInTx } from "../../../src/lib/matches/unassociated-result";
import { recordCanonicalMapResultInTx, supplementUnassociatedMapResultInTx } from "../../../src/lib/matches/results";

const input = { sides: { a: { name: "临时 A", logoUrl: null }, b: { name: "临时 B", logoUrl: null } }, format: "bo1", mapPool: ["de_mirage"], scheduledAt: null };

describe("independent match execution persistence", () => {
  it("creates, starts and finishes without an event, teams, roster, BP or telemetry", async () => {
    const pool = new Pool({ connectionString: localDatabaseUrl() });
    const database = drizzle(pool, { schema });
    try {
      await expect(database.transaction(tx => createUnassociatedMatchInTx(tx, { ...input, format: "bo3" }, "execution-test"))).rejects.toThrow("地图池不足");
      const match = await database.transaction(tx => createUnassociatedMatchInTx(tx, input, "execution-test"));
      expect(match.seasonId).toBeNull();
      expect(match.entryAId).toBeNull();
      const document = await database.transaction(tx => loadUnassociatedMizarDocumentInTx(tx, match.id));
      expect(document.schemaVersion).toBe("rivalhub.broadcast-manifest.v2");
      expect(document.match.competition).toBeNull();
      expect(document.entrants.a).toMatchObject({ name: "临时 A", roster: { players: [] } });
      const start = await database.transaction(tx => applyMatchStatusTransitionInTx(tx, { matchId: match.id, nextStatus: "in_progress", actorId: "execution-test" }));
      expect(start.lineups).toBeNull();
      await database.transaction(tx => concludeUnassociatedMatchInTx(tx, { matchId: match.id, actorId: "execution-test", conclusion: { kind: "omitted" } }));
      const [finished] = await database.select().from(schema.matches).where(eq(schema.matches.id, match.id));
      expect(finished).toMatchObject({ status: "finished", scoreA: null, scoreB: null, resultDisposition: "omitted", isForfeit: false });
      expect(await database.select().from(schema.matchMaps).where(eq(schema.matchMaps.matchId, match.id))).toEqual([]);
      expect(await database.select().from(schema.matchRosters).where(eq(schema.matchRosters.matchId, match.id))).toEqual([]);
    } finally { await pool.end(); }
  });
  it("records an actual map result without requiring declared players or online BP", async () => {
    const pool = new Pool({ connectionString: localDatabaseUrl() });
    const database = drizzle(pool, { schema });
    try {
      const match = await database.transaction(tx => createUnassociatedMatchInTx(tx, input, "execution-test"));
      await database.transaction(tx => applyMatchStatusTransitionInTx(tx, { matchId: match.id, nextStatus: "in_progress", actorId: "execution-test" }));
      await database.transaction(tx => recordCanonicalMapResultInTx(tx, { matchId: match.id, mapOrder: 1, mapName: "de_mirage", scoreA: 13, scoreB: 7, pickedByEntryId: null, teamAStartSide: null, actorId: "execution-test" }));
      const [finished] = await database.select().from(schema.matches).where(eq(schema.matches.id, match.id));
      expect(finished).toMatchObject({ status: "finished", scoreA: 1, scoreB: 0, resultDisposition: "recorded" });
    } finally { await pool.end(); }
  });
});


it('separates end, late evidence and reviewed corrections under the match lock', async () => {
  const pool = new Pool({ connectionString: localDatabaseUrl() });
  const database = drizzle(pool, { schema });
  const actorId = 'execution-result-test';
  const endedAt = new Date('2026-10-07T12:00:00Z');
  const later = new Date('2026-10-07T14:00:00Z');
  const create = () => database.transaction(tx => createUnassociatedMatchInTx(tx, { ...input, format: 'bo3', mapPool: resultFixture.match.mapPool }, actorId));
  const read = async (id: string) => (await database.select().from(schema.matches).where(eq(schema.matches.id, id)))[0]!;
  try {
    const aggregate = await create();
    const command = { matchId: aggregate.id, actorId, now: endedAt, conclusion: { kind: 'recorded' as const, scoreA: 2, scoreB: 1 } };
    await database.transaction(tx => concludeUnassociatedMatchInTx(tx, command));
    await database.transaction(tx => concludeUnassociatedMatchInTx(tx, { ...command, now: later }));
    expect((await read(aggregate.id)).completedAt).toEqual(endedAt);
    const document = await database.transaction(tx => loadUnassociatedMizarDocumentInTx(tx, aggregate.id));
    const normalized = JSON.parse(JSON.stringify({ ...document, revision: 'contract-fixture' }).replaceAll(aggregate.id, resultFixture.match.matchId));
    expect(normalized).toEqual(resultFixture);
    await expect(database.transaction(tx => concludeUnassociatedMatchInTx(tx, { ...command, conclusion: { kind: 'recorded', scoreA: 0, scoreB: 2 } }))).rejects.toThrow('更正');

    const playing = await create();
    await database.transaction(tx => applyMatchStatusTransitionInTx(tx, { matchId: playing.id, nextStatus: 'in_progress', actorId }));
    await database.transaction(tx => recordCanonicalMapResultInTx(tx, { matchId: playing.id, actorId, mapOrder: 1, mapName: 'de_mirage', scoreA: 13, scoreB: 7, pickedByEntryId: null, teamAStartSide: null }));
    await expect(database.transaction(tx => concludeUnassociatedMatchInTx(tx, { matchId: playing.id, actorId, conclusion: { kind: 'recorded', scoreA: 0, scoreB: 2 } }))).rejects.toThrow('冲突');
    expect((await read(playing.id)).status).toBe('in_progress');

    const pending = await create();
    await database.transaction(tx => concludeUnassociatedMatchInTx(tx, { matchId: pending.id, actorId, now: endedAt, conclusion: { kind: 'pending' } }));
    const first = { matchId: pending.id, actorId, mapOrder: 1, mapName: 'de_mirage', scoreA: 13, scoreB: 7, pickedByEntryId: null, teamAStartSide: null };
    await database.transaction(tx => supplementUnassociatedMapResultInTx(tx, first));
    await database.transaction(tx => supplementUnassociatedMapResultInTx(tx, first));
    expect(await read(pending.id)).toMatchObject({ completedAt: endedAt, status: 'finished', resultDisposition: 'pending', scoreA: null });
    await expect(database.transaction(tx => supplementUnassociatedResultInTx(tx, { matchId: pending.id, actorId, conclusion: { kind: 'recorded', scoreA: 0, scoreB: 2 } }))).rejects.toThrow('冲突');
    await database.transaction(tx => supplementUnassociatedMapResultInTx(tx, { ...first, mapOrder: 2, mapName: 'de_nuke' }));
    expect(await read(pending.id)).toMatchObject({ completedAt: endedAt, resultDisposition: 'recorded', scoreA: 2, scoreB: 0 });
    await expect(database.transaction(tx => concludeUnassociatedMatchInTx(tx, { matchId: pending.id, actorId, conclusion: { kind: 'recorded', scoreA: 0, scoreB: 2 } }))).rejects.toThrow('更正');
    const beforeCorrection = await read(pending.id);
    await expect(database.transaction(tx => correctUnassociatedResultInTx(tx, { matchId: pending.id, actorId, expectedUpdatedAt: beforeCorrection.updatedAt, reason: '复核', conclusion: { kind: 'recorded', scoreA: 0, scoreB: 2 } }))).rejects.toThrow('冲突');
    const maps = await database.select().from(schema.matchMaps).where(eq(schema.matchMaps.matchId, pending.id));
    await database.transaction(tx => correctUnassociatedResultInTx(tx, { matchId: pending.id, actorId, expectedUpdatedAt: beforeCorrection.updatedAt, reason: '纠正双方比分方向', conclusion: { kind: 'recorded', scoreA: 0, scoreB: 2 }, maps: maps.map(map => ({ mapId: map.id, scoreA: 7, scoreB: 13 })) }));
    expect(await read(pending.id)).toMatchObject({ completedAt: endedAt, scoreA: 0, scoreB: 2 });
    const audits = await database.select().from(schema.auditLogs).where(eq(schema.auditLogs.targetId, pending.id));
    expect(audits.some(row => JSON.stringify(row.meta).includes('correct_result'))).toBe(true);
    expect(audits.map(row => row.meta)).toContainEqual(expect.objectContaining({ before: { disposition: 'recorded', scoreA: 2, scoreB: 0 }, after: { disposition: 'recorded', scoreA: 0, scoreB: 2 } }));

    const lateTotal = await create();
    await database.transaction(tx => concludeUnassociatedMatchInTx(tx, { matchId: lateTotal.id, actorId, now: endedAt, conclusion: { kind: 'pending' } }));
    for (let retry = 0; retry < 2; retry++) await database.transaction(tx => supplementUnassociatedResultInTx(tx, { matchId: lateTotal.id, actorId, now: later, conclusion: { kind: 'recorded', scoreA: 2, scoreB: 1 } }));
    expect(await read(lateTotal.id)).toMatchObject({ completedAt: endedAt, updatedAt: later, scoreA: 2, scoreB: 1 });
    const lateMap = { matchId: lateTotal.id, actorId, mapOrder: 3, mapName: 'de_inferno', scoreA: 13, scoreB: 7, pickedByEntryId: null, teamAStartSide: null };
    await database.transaction(tx => supplementUnassociatedMapResultInTx(tx, lateMap));
    await database.transaction(tx => supplementUnassociatedMapResultInTx(tx, { ...lateMap, mapOrder: 1, mapName: 'de_mirage' }));
    expect(await read(lateTotal.id)).toMatchObject({ completedAt: endedAt, scoreA: 2, scoreB: 1 });
    await database.transaction(tx => supplementUnassociatedMapResultInTx(tx, { ...lateMap, mapOrder: 2, mapName: 'de_nuke', scoreA: 7, scoreB: 13 }));
    const official = await seedFixture({ unboundSource: true });
    await expect(database.transaction(tx => concludeUnassociatedMatchInTx(tx, { matchId: official.matchId, actorId, conclusion: { kind: 'omitted' } }))).rejects.toThrow('赛事比赛');
  } finally { await pool.end(); }
});


it("enforces exclusive match variants and explicit independent result state in PostgreSQL", async () => {
  const pool = new Pool({ connectionString: localDatabaseUrl() });
  const database = drizzle(pool, { schema });
  try {
    const match = await database.transaction(tx => createUnassociatedMatchInTx(tx, input, "variant-test"));
    for (const patch of [
      { status: "finished" as const },
      { scoreA: 1, scoreB: 0 },
      { status: "in_progress" as const, resultDisposition: "pending" as const },
      { status: "finished" as const, resultDisposition: "recorded" as const },
      { status: "finished" as const, resultDisposition: "omitted" as const, scoreA: 1, scoreB: 0 },
    ]) {
      await expect(database.update(schema.matches).set(patch).where(eq(schema.matches.id, match.id))).rejects.toThrow();
    }
    for (const disposition of ["pending", "omitted"] as const) {
      await database.update(schema.matches).set({ status: "finished", resultDisposition: disposition }).where(eq(schema.matches.id, match.id));
    }
    await database.update(schema.matches).set({ resultDisposition: "recorded", scoreA: 1, scoreB: 0 }).where(eq(schema.matches.id, match.id));
    const fixture = await seedFixture({ unboundSource: true });
    await expect(database.update(schema.matches).set({ executionContext: match.executionContext }).where(eq(schema.matches.id, fixture.matchId))).rejects.toThrow();
    const [official] = await database.select().from(schema.matches).where(eq(schema.matches.id, fixture.matchId));
    expect(official?.executionContext).toBeNull();
  } finally { await pool.end(); }
});
