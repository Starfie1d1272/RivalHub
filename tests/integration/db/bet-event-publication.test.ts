import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { lockBetProgram, reconcileBetInTx, stakeBetInTx } from "@/lib/bet/service";
import { fixture, read } from "./harness/bet-fixture";

describe("Major-24 independent event BET publication", () => {
  it("opens champion before seeds, waits for frozen player options and keeps stage supply separate", async () => fixture(async f => {
    const ids = [...f.entryIds];
    for (let i = ids.length; i < 24; i++) {
      const id = randomUUID(), revision = randomUUID(); ids.push(id);
      await f.db.transaction(async tx => {
        await tx.insert(schema.competitionEntries).values({ id, competitionId: f.seasonId, source: "event_native", name: `正式队伍 ${i}`, representativeUserId: f.userId, currentRosterRevisionId: revision, approvedRosterRevisionId: revision, registrationStatus: "approved" });
        await tx.insert(schema.competitionEntryRepresentativeChanges).values({ entryId: id, toUserId: f.userId, changedByActorId: "test" });
        await tx.insert(schema.competitionEntryRosterRevisions).values({ id: revision, entryId: id, revisionNumber: 1, status: "approved", createdBy: "test", approvedAt: new Date() });
      });
    }
    await f.db.insert(schema.majorTournamentEntrants).values(ids.slice(0, 23).map(competitionEntryId => ({ seasonId: f.seasonId, competitionEntryId })));
    await f.db.insert(schema.competitionQualificationRuns).values({ seasonId: f.seasonId, format: "short_swiss_2w2l", targetEntrantCount: 24, candidateCount: 30, directEntryCount: 18, playInEntryCount: 12, qualifierCount: 6, configuredBy: "test", startedAt: new Date(), startedBy: "test" });
    const reconcile = () => f.db.transaction(async tx => { await lockBetProgram(tx, f.seasonId); await reconcileBetInTx(tx, f.seasonId); });
    const eventMarkets = async () => (await read(f.db, f.seasonId, f.userId)).markets.filter(m => m.group === "赛事");
    const oldMatchMarkets = await f.db.select().from(schema.betMarkets).where(eq(schema.betMarkets.seasonId, f.seasonId));
    await reconcile(); expect(await eventMarkets()).toEqual([]);
    await f.db.insert(schema.majorTournamentEntrants).values({ seasonId: f.seasonId, competitionEntryId: ids[23]! });
    await reconcile(); expect(await eventMarkets()).toEqual([]);
    await f.db.update(schema.competitionQualificationRuns).set({ completedAt: new Date() }).where(eq(schema.competitionQualificationRuns.seasonId, f.seasonId));
    await reconcile();
    const champion = (await eventMarkets())[0]!;
    expect(champion).toMatchObject({ type: "champion", state: "open", canStake: true });
    expect(champion.options).toHaveLength(24);
    await reconcile(); expect(await eventMarkets()).toHaveLength(1);
    expect(await f.db.select().from(schema.betLedger).where(and(eq(schema.betLedger.seasonId, f.seasonId), eq(schema.betLedger.kind, "stage")))).toEqual([]);
    for (const [i, entryId] of ids.entries()) {
      const revision = await f.db.query.competitionEntries.findFirst({ where: eq(schema.competitionEntries.id, entryId) });
      const members = Array.from({ length: 5 }, (_, j) => i === 0 && j === 0 ? f.userId : randomUUID());
      await f.db.insert(schema.users).values(members.filter(id => id !== f.userId).map(id => ({ id, email: `${id}@example.test`, displayName: id })));
      const [roster] = await f.db.insert(schema.eventRosters).values({ entryId, sourceRosterRevisionId: revision!.approvedRosterRevisionId, status: "confirmed", confirmedAt: new Date(), confirmedBy: "test" }).returning();
      await f.db.insert(schema.eventRosterMembers).values(members.map(userId => ({ eventRosterId: roster!.id, userId, isPrimaryStarter: true })));
    }
    await reconcile(); expect(await eventMarkets()).toHaveLength(1);
    expect((await eventMarkets())[0]!.options).toEqual(champion.options);
    await f.db.transaction(tx => stakeBetInTx(tx, { seasonId: f.seasonId, userId: f.userId, marketId: champion.id, optionId: champion.options.find(o => o.entity?.kind === "team" && o.entity.entryId === ids[0])!.id, amount: "100", requestId: randomUUID() }));
    await f.db.update(schema.eventRosters).set({ status: "frozen", frozenAt: new Date(), frozenBy: "test" });
    await reconcile(); expect(await eventMarkets()).toHaveLength(1);
    await f.db.insert(schema.majorPrestartStates).values({ seasonId: f.seasonId, entrantsLockedAt: new Date(), entrantsLockedBy: "test" });
    await reconcile();
    const frag = (await eventMarkets()).find(m => m.type === "top_fragger")!;
    expect(frag).toMatchObject({ state: "open", canStake: true, restriction: null });
    expect(frag.options).toHaveLength(120);
    await f.db.transaction(tx => stakeBetInTx(tx, { seasonId: f.seasonId, userId: f.userId, marketId: frag.id, optionId: frag.options.find(o => o.entity?.kind === "player" && o.entity.userId === f.userId)!.id, amount: "100", requestId: randomUUID() }));
    await reconcile(); expect(await eventMarkets()).toHaveLength(2);
    const after = await f.db.select().from(schema.betMarkets).where(eq(schema.betMarkets.seasonId, f.seasonId));
    expect(after.filter(m => oldMatchMarkets.some(old => old.id === m.id))).toEqual(oldMatchMarkets);
    expect((await read(f.db, f.seasonId, f.userId)).balance).toBe("800");
    await f.db.update(schema.matches).set({ gameplayStartedAt: new Date() }).where(eq(schema.matches.id, f.matchId));
    await reconcile(); expect((await eventMarkets()).every(m => m.state === "locked")).toBe(true);
  }, { major24: true }));
});
