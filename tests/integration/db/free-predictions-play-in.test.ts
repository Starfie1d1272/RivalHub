import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { fixture } from "./harness/free-prediction-fixture";
import { submitFreePredictionInTx } from "@/lib/free-predictions/service";
import { readFreePredictionBoard } from "@/lib/free-predictions/data";
import { normalizeRegistrationConfig } from "@/lib/seasons/compatibility";

type Fixture = Parameters<Parameters<typeof fixture>[0]>[0];
async function playIn(f: Fixture) {
  await f.db.update(schema.seasons).set({ status: "registration" }).where(eq(schema.seasons.id, f.seasonId));
  const [run] = await f.db.insert(schema.competitionQualificationRuns).values({
    seasonId: f.seasonId, format: "direct_bo3", targetEntrantCount: 1, candidateCount: 2,
    directEntryCount: 0, playInEntryCount: 2, qualifierCount: 1, configuredBy: "test",
    startedAt: new Date(), startedBy: "test",
  }).returning();
  await f.db.update(schema.matches).set({
    qualificationRunId: run!.id, majorStageRunId: null, ownership: "manual", managedKey: null, stage: "play-in",
  }).where(eq(schema.matches.id, f.matchId));
  return run!;
}
const board = (f: Fixture) => f.db.transaction(tx => readFreePredictionBoard(tx, f.seasonId, f.userId));
const submit = (f: Fixture, kind: "result" | "bp", selection: string[]) => f.db.transaction(tx => submitFreePredictionInTx(tx, {
  seasonId: f.seasonId, matchId: f.matchId, userId: f.userId, kind, selection, requestId: randomUUID(),
}));

// Real DB evidence protects read/write lifecycle agreement and permanent BP fences.
describe("free Play-in predictions", () => {
  it("opens result and BP for a started registration Play-in without BET", async () => fixture(async f => {
    await playIn(f);
    const season = await f.db.query.seasons.findFirst({ where: eq(schema.seasons.id, f.seasonId) });
    const selection = normalizeRegistrationConfig(season!.registrationConfig).mapPool.slice(0, 3);
    expect((await board(f)).matches[0]).toMatchObject({ stage: "PLAY-IN", result: { canSubmit: true }, bp: { canSubmit: true } });
    await submit(f, "result", [f.entryIds[0]!]);
    await submit(f, "bp", selection);
    expect((await board(f)).matches[0]).toMatchObject({ result: { mine: f.entryIds[0], support: { total: 1 } }, bp: { mine: [...selection].sort(), support: { total: 1 } } });
    expect(await f.db.select().from(schema.betAccounts)).toHaveLength(0);
  }));

  it("rejects unstarted/completed Play-in and closed seasons in both read and write paths", async () => fixture(async f => {
    const run = await playIn(f);
    const season = await f.db.query.seasons.findFirst({ where: eq(schema.seasons.id, f.seasonId) });
    const selections = { result: [f.entryIds[0]!], bp: normalizeRegistrationConfig(season!.registrationConfig).mapPool.slice(0, 3) };
    const reject = async () => {
      const match = (await board(f)).matches[0]!;
      for (const kind of ["result", "bp"] as const) {
        expect(match[kind]).toMatchObject({ canSubmit: false, restriction: { code: "season_closed" } });
        await expect(submit(f, kind, selections[kind])).rejects.toThrow(/不可预测|已归档/);
      }
    };
    await f.db.update(schema.competitionQualificationRuns).set({ startedAt: null, startedBy: null }).where(eq(schema.competitionQualificationRuns.id, run.id));
    await reject();
    await f.db.update(schema.competitionQualificationRuns).set({ startedAt: new Date(), startedBy: "test", completedAt: new Date() }).where(eq(schema.competitionQualificationRuns.id, run.id));
    await reject();
    await f.db.update(schema.competitionQualificationRuns).set({ completedAt: null }).where(eq(schema.competitionQualificationRuns.id, run.id));
    for (const status of ["draft", "voting", "drafting", "playing", "finished", "archived"] as const) {
      await f.db.update(schema.seasons).set({ status }).where(eq(schema.seasons.id, f.seasonId));
      await reject();
    }
    expect(await f.db.select().from(schema.freePredictionChoices)).toHaveLength(0);
  }));

  it("keeps Play-in BP permanently closed after session removal while result stays open", async () => fixture(async f => {
    await playIn(f);
    const season = await f.db.query.seasons.findFirst({ where: eq(schema.seasons.id, f.seasonId) });
    const mapPool = normalizeRegistrationConfig(season!.registrationConfig).mapPool;
    await submit(f, "bp", mapPool.slice(0, 3));
    await f.db.insert(schema.matchVetoSessions).values({ matchId: f.matchId, mapPoolSnapshot: mapPool, startedAt: new Date() });
    await f.db.delete(schema.matchVetoSessions).where(eq(schema.matchVetoSessions.matchId, f.matchId));
    expect((await board(f)).matches[0]).toMatchObject({ result: { canSubmit: true }, bp: { canSubmit: false, locked: true, restriction: { code: "started" } } });
    await expect(submit(f, "bp", mapPool.slice(0, 3))).rejects.toThrow("锁定");
    await submit(f, "result", [f.entryIds[0]!]);
  }));
});
