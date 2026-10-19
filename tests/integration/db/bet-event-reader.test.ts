import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { loadBetFacts } from "@/lib/bet/facts";
import { lockBetProgram, reconcileBetInTx, stakeBetInTx } from "@/lib/bet/service";
import { fixture, read } from "./harness/bet-fixture";

// Seed future persisted terms to verify the actual reader-only deployment.
// Real PostgreSQL, admission, reconciliation and ledger owners stay unmocked.
describe("event BET pre-seed reader compatibility", () => {
  it("retains early champion terms, admits participants, locks permanently and refunds changed entrants once", async () => fixture(async f => {
    const ids = [...f.entryIds];
    for (let i = ids.length; i < 32; i++) {
      const id = randomUUID(), revision = randomUUID(); ids.push(id);
      await f.db.transaction(async tx => {
        await tx.insert(schema.competitionEntries).values({ id, competitionId: f.seasonId, source: "event_native", name: `队伍 ${i}`, representativeUserId: f.userId, currentRosterRevisionId: revision, approvedRosterRevisionId: revision, registrationStatus: "approved" });
        await tx.insert(schema.competitionEntryRepresentativeChanges).values({ entryId: id, toUserId: f.userId, changedByActorId: "test" });
        await tx.insert(schema.competitionEntryRosterRevisions).values({ id: revision, entryId: id, revisionNumber: 1, status: "approved", createdBy: "test", approvedAt: new Date() });
      });
    }
    await f.db.insert(schema.majorTournamentEntrants).values(ids.map(competitionEntryId => ({ seasonId: f.seasonId, competitionEntryId })));
    await f.db.insert(schema.competitionQualificationRuns).values({ seasonId: f.seasonId, format: "direct_bo3", targetEntrantCount: 32, candidateCount: 34, directEntryCount: 30, playInEntryCount: 4, qualifierCount: 2, configuredBy: "test", startedAt: new Date(), startedBy: "test" });
    const facts = () => f.db.transaction(tx => loadBetFacts(tx, f.seasonId));
    expect((await facts()).event.entryIds).toEqual([]);
    await f.db.update(schema.competitionQualificationRuns).set({ completedAt: new Date() }).where(eq(schema.competitionQualificationRuns.seasonId, f.seasonId));
    expect((await facts()).event.entryIds).toEqual([...ids].sort());
    expect((await facts()).event.playerIds).toEqual([]);
    const entry = await f.db.query.competitionEntries.findFirst({ where: eq(schema.competitionEntries.id, ids[0]!) });
    const [roster] = await f.db.insert(schema.eventRosters).values({ entryId: ids[0]!, sourceRosterRevisionId: entry!.approvedRosterRevisionId, status: "confirmed", confirmedAt: new Date(), confirmedBy: "test" }).returning();
    await f.db.insert(schema.eventRosterMembers).values({ eventRosterId: roster!.id, userId: f.userId });
    const [market] = await f.db.insert(schema.betMarkets).values({ seasonId: f.seasonId, type: "champion", marketKey: `future-event/${randomUUID()}`, subject: { kind: "event", entryIds: [...ids].sort(), playerIds: [] } }).returning();
    const choices = await f.db.insert(schema.betOptions).values(ids.map((key, position) => ({ marketId: market!.id, key, label: `队伍 ${position}`, position }))).returning();
    const reconcile = () => f.db.transaction(async tx => { await lockBetProgram(tx, f.seasonId); await reconcileBetInTx(tx, f.seasonId); });
    const before = (await read(f.db, f.seasonId, f.userId)).balance;
    const board = await read(f.db, f.seasonId, f.userId);
    expect(board.markets.find(m => m.id === market!.id)).toMatchObject({ canStake: true, restriction: null });
    expect(board.markets.find(m => m.type === "match_winner")).toMatchObject({ canStake: false });
    await f.db.transaction(tx => stakeBetInTx(tx, { seasonId: f.seasonId, userId: f.userId, marketId: market!.id, optionId: choices[0]!.id, amount: "100", requestId: randomUUID() }));
    await reconcile();
    expect((await read(f.db, f.seasonId, f.userId)).markets.find(m => m.id === market!.id)?.state).toBe("open");
    expect((await facts()).eventPublication).toMatchObject({ entrantsReady: true, rostersReady: false, seedsConfirmed: false });
    expect(await f.db.select().from(schema.betLedger).where(and(eq(schema.betLedger.seasonId, f.seasonId), eq(schema.betLedger.kind, "stage")))).toEqual([]);
    await f.db.insert(schema.matchVetoSessions).values({ matchId: f.matchId, startedAt: new Date(), mapPoolSnapshot: ["de_inferno", "de_nuke", "de_mirage"] });
    await reconcile();
    await f.db.update(schema.matchVetoSessions).set({ startedAt: null }).where(eq(schema.matchVetoSessions.matchId, f.matchId));
    await reconcile();
    expect((await read(f.db, f.seasonId, f.userId)).markets.find(m => m.id === market!.id)?.state).toBe("locked");
    await f.db.delete(schema.majorTournamentEntrants).where(and(eq(schema.majorTournamentEntrants.seasonId, f.seasonId), eq(schema.majorTournamentEntrants.competitionEntryId, ids[31]!)));
    await reconcile();
    expect((await read(f.db, f.seasonId, f.userId)).markets.find(m => m.id === market!.id)?.state).toBe("refunded");
    expect((await read(f.db, f.seasonId, f.userId)).balance).toBe(before);
    const ledger = await f.db.select().from(schema.betLedger).where(eq(schema.betLedger.seasonId, f.seasonId));
    await reconcile();
    expect(await f.db.select().from(schema.betLedger).where(eq(schema.betLedger.seasonId, f.seasonId))).toEqual(ledger);
  }));
});
