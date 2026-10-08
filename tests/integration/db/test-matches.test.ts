import { exportQuery } from "../../../scripts/db/preview/policy";
import { getPublicSeasonResults } from "@/lib/seasons/public-results";
import { getPublicSeasonStagePresentation } from "@/lib/seasons/public-stage";
import { issueLiveViewerToken } from "@/lib/mizar/live";
import evidenceFixture from "../../fixtures/demo-evidence/normal-map-v1.json";
import { parseRivalHubDemoEvidenceV1 } from "@/lib/demo-evidence/contract";
import { submitRivalHubEvidence } from "@/lib/demo-integration/submit";
import { loadCanonicalTarget } from "@/lib/demo-integration/validation";
import { buildEvidenceRevisionForTarget } from "@/lib/demo-integration/revision";
import { getMatchPlayerDetail, getTournamentPlayerDetail } from "@/lib/stats/tournament-query";
import { loadBetFacts } from "@/lib/bet/facts";
import { getPublicPlayerRecord } from "@/lib/players/public-record";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { seedFixture } from "./harness/mizar";
import { createTestMatchInTx, loadTestMatches } from "@/lib/matches/test-matches";
import { officialMatchCondition } from "@/lib/matches/scope";
import { loadOfficialMatchRows } from "@/lib/matches/read-official";
import { persistMatchRosterInTx } from "@/lib/match-rosters/service";
import { readVetoRoomCore, requestVetoStart, submitVetoCommand } from "@/lib/matches/veto-room/service";
import { recordCanonicalMapResultInTx, supplementUnassociatedMapResultInTx } from "@/lib/matches/results";
import { correctUnassociatedResultInTx, concludeUnassociatedMatchInTx, supplementUnassociatedResultInTx } from "@/lib/matches/unassociated-result";
import { loadMizarMatchDocumentInTx } from "@/lib/mizar/context";
import { readRivalHubEvents } from "@/lib/demo-integration/read";

async function create() {
  const f = await seedFixture();
  const entries = await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, f.seasonId));
  const captainA = entries.find(e => e.id === f.entryAId)!.representativeUserId;
  const captainB = entries.find(e => e.id === f.entryBId)!.representativeUserId;
  const [operator] = await db.insert(schema.users).values({ email: `${randomUUID()}@local.test` }).returning();
  const input = { seasonId: f.seasonId, entryAId: f.entryAId, entryBId: f.entryBId, operatorAId: operator.id, format: "bo3" as const, privilegedSide: "a" as const, scheduledAt: null };
  const created = await db.transaction(tx => createTestMatchInTx(tx, input, captainA));
  const match = (await db.select().from(schema.matches).where(eq(schema.matches.id, created.matchId)))[0]!;
  return { ...f, match, input, captainA, captainB, operatorA: operator.id };
}
async function playBp(f: Awaited<ReturnType<typeof create>>) {
  for (const [entryId, captain] of [[f.entryAId, f.captainA], [f.entryBId, f.captainB]]) {
    const roster = await db.query.eventRosters.findFirst({ where: eq(schema.eventRosters.entryId, entryId) });
    const members = await db.select().from(schema.eventRosterMembers).where(eq(schema.eventRosterMembers.eventRosterId, roster!.id));
    await db.transaction(tx => persistMatchRosterInTx(tx, { match: f.match as typeof f.match & { seasonId: string; entryAId: string; entryBId: string; stage: string }, entryId, submittedBy: captain, source: "participant", starterIds: members.map(m => m.id) }));
  }
  const start = async (entryId: string, actorId: string) => {
    const { session } = await readVetoRoomCore(f.match.id);
    return requestVetoStart({ matchId: f.match.id, entryId, actorId, expectedRevision: session.revision, expectedTurnKey: session.currentTurnKey });
  };
  await expect(start(f.entryAId, f.captainA)).rejects.toThrow("BP 负责人");
  await start(f.entryAId, f.operatorA);
  await start(f.entryBId, f.captainB);
  for (let i = 0; i < 16; i++) {
    const state = await readVetoRoomCore(f.match.id);
    if (state.session.completedAt) return;
    const turn = state.currentTurn!;
    const used = new Set(state.steps.filter(s => s.actionType !== "side_pick").map(s => s.mapName));
    const command = turn.actionType === "role_select" ? { kind: "role_select" as const, entryId: f.entryAId }
      : { kind: "step" as const, actionType: turn.actionType, ...(turn.actionType === "side_pick" ? { side: "ct" as const } : { mapName: f.match.testConfig!.mapPool.find(m => !used.has(m))! }) };
    expect(await submitVetoCommand({ matchId: f.match.id, actorId: turn.actorEntryId === f.entryAId ? f.operatorA : f.captainB, expectedRevision: state.session.revision, expectedTurnKey: turn.key, clientRequestId: randomUUID(), command })).toBe("applied");
  }
  throw new Error("BP did not complete");
}

describe("event test matches", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("keeps prepared rosters unchanged and refuses to resynchronize during active matches", async () => {
    const f = await create();
    const rosterRows = () => db.select().from(schema.eventRosters).where(inArray(schema.eventRosters.entryId, [f.entryAId, f.entryBId])).orderBy(schema.eventRosters.id);
    const before = await rosterRows();
    const membersBefore = await db.select().from(schema.eventRosterMembers).where(inArray(schema.eventRosterMembers.eventRosterId, before.map(r => r.id))).orderBy(schema.eventRosterMembers.id);
    await db.transaction(tx => createTestMatchInTx(tx, f.input, f.captainA));
    expect(await rosterRows()).toEqual(before);
    expect(await db.select().from(schema.eventRosterMembers).where(inArray(schema.eventRosterMembers.eventRosterId, before.map(r => r.id))).orderBy(schema.eventRosterMembers.id)).toEqual(membersBefore);
    // Preparing rosters cannot disturb an ongoing match, including test matches.
    await db.update(schema.eventRosters).set({ status: "preparing", confirmedAt: null, confirmedBy: null }).where(eq(schema.eventRosters.entryId, f.entryAId));
    const preparing = await rosterRows();
    await expect(db.transaction(tx => createTestMatchInTx(tx, f.input, f.captainA))).rejects.toThrow("进行中的比赛");
    expect(await rosterRows()).toEqual(preparing);
    await db.update(schema.eventRosters).set({ sourceRosterRevisionId: null }).where(eq(schema.eventRosters.entryId, f.entryAId));
    const stale = await rosterRows();
    await expect(db.transaction(tx => createTestMatchInTx(tx, f.input, f.captainA))).rejects.toThrow("进行中的比赛");
    expect(await rosterRows()).toEqual(stale);
  });
  it("allows only active tests before playing and retains ordinary LIVE gates", async () => {
    vi.stubEnv("SUPABASE_JWT_SECRET", "integration-viewer-signing-key-only");
    const f = await create();
    await db.update(schema.matches).set({ status: "in_progress" }).where(eq(schema.matches.id, f.match.id));
    for (const status of ["registration", "voting", "drafting"] as const) {
      await db.update(schema.seasons).set({ status }).where(eq(schema.seasons.id, f.seasonId));
      const credential = await issueLiveViewerToken(f.match.id);
      expect(credential.topic).toBe(`match-live:${f.match.id}`);
      await expect(issueLiveViewerToken(f.matchId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    for (const status of ["scheduled", "finished", "cancelled"] as const) {
      await db.update(schema.matches).set({ status }).where(eq(schema.matches.id, f.match.id));
      await expect(issueLiveViewerToken(f.match.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    await db.update(schema.matches).set({ status: "in_progress" }).where(eq(schema.matches.id, f.match.id));
    for (const status of ["draft", "finished", "archived"] as const) {
      await db.update(schema.seasons).set({ status }).where(eq(schema.seasons.id, f.seasonId));
      await expect(issueLiveViewerToken(f.match.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    await db.update(schema.seasons).set({ status: "playing" }).where(eq(schema.seasons.id, f.seasonId));
    expect((await issueLiveViewerToken(f.matchId)).topic).toBe(`match-live:${f.matchId}`);
  });
  it("atomically corrects maps and series with audit and a stable execution end", async () => {
    const f = await create();
    await playBp(f);
    const maps = await db.select().from(schema.matchMaps).where(eq(schema.matchMaps.matchId, f.match.id)).orderBy(schema.matchMaps.mapOrder);
    for (const map of maps.slice(0, 2)) await db.transaction(tx => recordCanonicalMapResultInTx(tx, { matchId: f.match.id, actorId: f.captainA, mapOrder: map.mapOrder, mapName: map.mapName, scoreA: 13, scoreB: 9, pickedByEntryId: null, teamAStartSide: null }));
    const before = (await db.query.matches.findFirst({ where: eq(schema.matches.id, f.match.id) }))!;
    const command = { matchId: f.match.id, actorId: f.captainA, expectedUpdatedAt: before.updatedAt, reason: "双方比分录反", conclusion: { kind: "recorded" as const, scoreA: 0, scoreB: 2 } };
    await expect(db.transaction(tx => correctUnassociatedResultInTx(tx, { ...command, maps: [{ mapId: maps[0].id, scoreA: 9, scoreB: 13 }] }))).rejects.toThrow("冲突");
    expect((await db.query.matchMaps.findFirst({ where: eq(schema.matchMaps.id, maps[0].id) }))!.scoreA).toBe(13);
    await db.transaction(tx => correctUnassociatedResultInTx(tx, { ...command, maps: maps.slice(0, 2).map(map => ({ mapId: map.id, scoreA: 9, scoreB: 13 })) }));
    const after = (await db.query.matches.findFirst({ where: eq(schema.matches.id, f.match.id) }))!;
    expect(after).toMatchObject({ scoreA: 0, scoreB: 2, completedAt: before.completedAt });
    const audits = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.targetId, f.match.id));
    expect(audits.map(row => row.meta)).toEqual(expect.arrayContaining([expect.objectContaining({ operation: "correct_map_evidence", reason: command.reason, before: expect.arrayContaining([expect.objectContaining({ scoreA: 13, scoreB: 9 })]), after: expect.arrayContaining([expect.objectContaining({ scoreA: 9, scoreB: 13 })]) })]));
    await expect(db.transaction(tx => correctUnassociatedResultInTx(tx, command))).rejects.toThrow("重新核对");
  });

  it("runs captain lineups and designated two-sided BP, exports real maps, and completes without event progression", async () => {
    const f = await create();
    expect(f.match.testConfig).toMatchObject({ operatorAId: f.operatorA, operatorBId: f.captainB });
    const mirror = await db.execute(sql`${sql.raw(exportQuery("matches"))} WHERE id = ${f.match.id}`);
    expect(mirror.rows[0]?.test_config).toEqual({
      mapPool: f.match.testConfig!.mapPool, operatorAId: f.operatorA, operatorBId: f.captainB,
    });
    expect((await loadTestMatches({ viewerId: f.operatorA })).some(m => m.id === f.match.id)).toBe(true);
    expect(await db.select().from(schema.matches).where(and(eq(schema.matches.id, f.match.id), officialMatchCondition()))).toEqual([]);
    const season = (await db.query.seasons.findFirst({ where: eq(schema.seasons.id, f.seasonId) }))!;
    const publicBefore = { results: await getPublicSeasonResults(season), stage: await getPublicSeasonStagePresentation(season) };
    const officialBefore = await loadOfficialMatchRows(eq(schema.matches.seasonId, f.seasonId));
    const before = await db.transaction(tx => loadBetFacts(tx, f.seasonId));
    const playerBefore = await getPublicPlayerRecord(f.captainA, { seasonId: f.seasonId });
    await playBp(f);
    const document = await db.transaction(tx => loadMizarMatchDocumentInTx(tx, f.match.id, f.seasonId));
    expect(document.match).toMatchObject({ isTest: true, stageLabel: "测试赛", status: "in_progress" });
    expect(document.entrants.a.roster.players).toHaveLength(5);
    expect(document.veto).toHaveLength(10);
    expect(document.maps).toHaveLength(3);
    expect(JSON.stringify(document)).not.toContain("private-review-marker");
    const events = await readRivalHubEvents({ seasonIds: [f.seasonId] });
    expect(events.events[0].series.some(s => s.id === f.match.id)).toBe(true);
    for (const map of document.maps.slice(0, 2)) {
      await db.transaction(tx => recordCanonicalMapResultInTx(tx, { matchId: f.match.id, actorId: f.captainA, mapOrder: map.mapOrder, mapName: map.mapName, scoreA: 13, scoreB: 9, pickedByEntryId: null, teamAStartSide: null }));
    }
    expect(await db.query.matches.findFirst({ where: eq(schema.matches.id, f.match.id) })).toMatchObject({ status: "finished", scoreA: 2, scoreB: 0, resultDisposition: "recorded" });
    // DAK targets the same actual BP map and roster; no test-only import bypass.
    const canonical = await db.transaction(tx => loadCanonicalTarget(tx, { seasonId: f.seasonId, matchId: f.match.id, matchMapId: document.maps[0].mapId }));
    let fixtureText = JSON.stringify(evidenceFixture).replaceAll("de_ancient", canonical.map.mapName);
    for (const [index, participant] of evidenceFixture.participants.entries()) fixtureText = fixtureText.replaceAll(participant.steamId64, f.steam64[index]);
    const evidence = parseRivalHubDemoEvidenceV1(JSON.parse(fixtureText));
    evidence.target = { seasonId: f.seasonId, stageKey: "test", matchId: f.match.id, matchMapId: canonical.map.id, mapOrder: 1, entryAId: f.entryAId, entryBId: f.entryBId, expectedMapName: canonical.map.mapName, evidenceRevision: buildEvidenceRevisionForTarget(canonical) };
    evidence.participants = evidence.participants.map(participant => {
      const player = canonical.roster.find(row => row.steam64 === participant.steamId64)!;
      return { ...participant, resolution: { status: "matched", userId: player.userId, eventRosterMemberId: player.eventRosterMemberId!, entryId: player.entryId } };
    });
    const [intent] = await db.insert(schema.dakPairingIntents).values({ pollTokenHash: randomUUID(), status: "authorized", authorizedByUserId: f.captainA, expiresAt: new Date(Date.now() + 600000), authorizedAt: new Date() }).returning();
    const [pairing] = await db.insert(schema.dakPairings).values({ pairingIntentId: intent.id, userId: f.captainA, tokenHash: randomUUID(), scopes: ["event:read", "demo:submit"], seasonIds: [f.seasonId] }).returning();
    const imported = await submitRivalHubEvidence({ input: evidence, pairingId: pairing.id, pairingScope: pairing });
    expect(imported).toMatchObject({ status: "synced", issues: [] });
    expect((await getMatchPlayerDetail(f.match.id, f.captainA))?.performance).toBeTruthy();
    expect((await getTournamentPlayerDetail({ seasonId: f.seasonId, playerId: f.captainA })).performance).toBeNull();
    expect(await loadOfficialMatchRows(eq(schema.matches.seasonId, f.seasonId))).toEqual(officialBefore);
    expect({ results: await getPublicSeasonResults(season), stage: await getPublicSeasonStagePresentation(season) }).toEqual(publicBefore);
    const after = await db.transaction(tx => loadBetFacts(tx, f.seasonId));
    expect(after.official).toEqual(before.official);
    expect(after.maps).toEqual(before.maps);
    expect(after.event).toEqual(before.event);
    expect(await getPublicPlayerRecord(f.captainA, { seasonId: f.seasonId })).toEqual(playerBefore);
    expect(await db.query.seasons.findFirst({ where: eq(schema.seasons.id, f.seasonId) })).toMatchObject({ status: "playing" });
  });
  it("rejects invalid affiliation and purpose changes; late results preserve execution end and known facts", async () => {
    const f = await create();
    await expect(db.transaction(tx => createTestMatchInTx(tx, { ...f.input, entryBId: f.entryAId }, f.captainA))).rejects.toThrow("双方队伍");
    await expect(db.transaction(tx => createTestMatchInTx(tx, { ...f.input, entryBId: randomUUID() }, f.captainA))).rejects.toThrow("双方必须");
    await expect(db.update(schema.matches).set({ testConfig: null }).where(eq(schema.matches.id, f.match.id))).rejects.toThrow();
    await expect(db.update(schema.matches).set({ entryAId: f.entryBId, entryBId: f.entryAId }).where(eq(schema.matches.id, f.match.id))).rejects.toThrow();
    await playBp(f);
    const endedAt = new Date();
    await db.transaction(tx => concludeUnassociatedMatchInTx(tx, { matchId: f.match.id, actorId: f.captainA, conclusion: { kind: "pending" }, now: endedAt }));
    const maps = await db.select().from(schema.matchMaps).where(eq(schema.matchMaps.matchId, f.match.id)).orderBy(schema.matchMaps.mapOrder);
    const result = { matchId: f.match.id, actorId: f.captainA, mapOrder: 1, mapName: maps[0].mapName, scoreA: 13, scoreB: 7, pickedByEntryId: null, teamAStartSide: null };
    await db.transaction(tx => supplementUnassociatedMapResultInTx(tx, result));
    await expect(db.transaction(tx => supplementUnassociatedResultInTx(tx, { matchId: f.match.id, actorId: f.captainA, conclusion: { kind: "recorded", scoreA: 0, scoreB: 2 } }))).rejects.toThrow("冲突");
    await db.transaction(tx => supplementUnassociatedMapResultInTx(tx, { ...result, mapOrder: 2, mapName: maps[1].mapName }));
    expect(await db.query.matches.findFirst({ where: eq(schema.matches.id, f.match.id) })).toMatchObject({ completedAt: endedAt, resultDisposition: "recorded", scoreA: 2 });
    await expect(db.transaction(tx => concludeUnassociatedMatchInTx(tx, { matchId: f.matchId, actorId: f.captainA, conclusion: { kind: "omitted" } }))).rejects.toThrow("正式赛事");
  });
});
