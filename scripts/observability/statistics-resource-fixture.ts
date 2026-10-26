/** Local resource data only: reuse the canonical Evidence and projection reducer. */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../src/db/client-runtime";
import * as schema from "../../src/db/schema";
import { assertLocalDatabaseUrl } from "../db/local-environment";
import { loadEffectiveMatchRoster } from "../../src/lib/match-rosters/effective";
import { parseRivalHubDemoEvidenceV1 } from "../../src/lib/demo-evidence/contract";
import { buildEvidenceRevisionForTarget } from "../../src/lib/demo-integration/revision";
import { STATISTICS_PROJECTION_VERSION } from "../../src/lib/stats/projection";
import { promoteDemoImportInTx } from "../../src/lib/demo-integration/promotion";
import { assertCompetitionMatch } from "../../src/lib/matches/competition-context";
import { getTournamentStats } from "../../src/lib/stats/tournament-query";

export async function createStatisticsResourceFixture(baseMatchId: string) {
  assertLocalDatabaseUrl(process.env.DATABASE_URL);
  if (process.env.RIVALHUB_DB_TARGET !== "local") throw new Error("LOCAL_STATISTICS_FIXTURE_REQUIRED");
  const base = await db.query.matches.findFirst({ where: eq(schema.matches.id, baseMatchId) });
  if (!base?.seasonId) throw new Error("LOCAL_STATISTICS_BASE_MISSING");
  assertCompetitionMatch(base);
  const roster = await loadEffectiveMatchRoster(db, [baseMatchId]);
  if (roster.length !== 10) throw new Error("LOCAL_STATISTICS_ROSTER_MISSING");
  const source = readFileSync("tests/fixtures/demo-evidence/normal-map-v1.json", "utf8");
  const original = parseRivalHubDemoEvidenceV1(JSON.parse(source));
  const members = { teamA: roster.filter(row => row.entryId === base.entryAId), teamB: roster.filter(row => row.entryId === base.entryBId) };
  const offset = { teamA: 0, teamB: 0 };
  let encoded = JSON.stringify(original);
  for (const player of original.participants) encoded = encoded.replaceAll(player.steamId64, members[player.observedTeamKey][offset[player.observedTeamKey]++]!.steam64!);
  const pairingId = randomUUID(), intentId = randomUUID();
  const matchIds: string[] = [], importIds: string[] = [], rosterIds: string[] = [];
  let projectionRows = 0, projectionTextBytes = 0;
  async function cleanup() {
    if (matchIds.length) await db.delete(schema.matchPlayerStats).where(inArray(schema.matchPlayerStats.matchId, matchIds));
    if (importIds.length) {
      await db.delete(schema.auditLogs).where(inArray(schema.auditLogs.targetId, importIds));
      await db.delete(schema.matchDemoImports).where(inArray(schema.matchDemoImports.id, importIds));
    }
    if (rosterIds.length) {
      await db.delete(schema.matchRosterPlayers).where(inArray(schema.matchRosterPlayers.rosterId, rosterIds));
      await db.delete(schema.matchRosters).where(inArray(schema.matchRosters.id, rosterIds));
    }
    if (matchIds.length) {
      await db.delete(schema.matchMaps).where(inArray(schema.matchMaps.matchId, matchIds));
      await db.delete(schema.matches).where(inArray(schema.matches.id, matchIds));
    }
    await db.delete(schema.dakPairings).where(eq(schema.dakPairings.id, pairingId));
    await db.delete(schema.dakPairingIntents).where(eq(schema.dakPairingIntents.id, intentId));
  }
  try {
    await db.insert(schema.dakPairingIntents).values({ id: intentId, pollTokenHash: randomUUID(), expiresAt: new Date(Date.now() + 3600_000) });
    await db.insert(schema.dakPairings).values({ id: pairingId, pairingIntentId: intentId, userId: roster[0]!.userId, tokenHash: randomUUID(), scopes: ["event:read"], seasonIds: [base.seasonId] });
    for (const [index, member] of roster.entries()) await db.update(schema.users).set({ displayName: `Resource Player ${String(index + 1).padStart(2, "0")}` }).where(eq(schema.users.id, member.userId));
    // At least 100 current maps and the investigation's 4,231,115 logical JSON
    // bytes. No arbitrary padding: every row comes from the canonical reducer.
    for (let series = 0; series < 100 && (projectionRows < 100 || projectionTextBytes < 4231115); series++) {
      const matchId = randomUUID(), a = randomUUID(), b = randomUUID();
      const completedAt = new Date("2026-09-28T00:30:00Z");
      await db.transaction(async tx => {
        const [match] = await tx.insert(schema.matches).values({ id: matchId, seasonId: base.seasonId, stage: base.stage,
          entryAId: base.entryAId, entryBId: base.entryBId, format: "bo3", status: "finished", scoreA: 2, scoreB: 0, completedAt }).returning();
        if (!match) throw new Error("LOCAL_STATISTICS_MATCH_MISSING");
        assertCompetitionMatch(match);
        await tx.insert(schema.matchRosters).values([{ id: a, matchId, entryId: base.entryAId, source: "admin_select", status: "submitted" }, { id: b, matchId, entryId: base.entryBId, source: "admin_select", status: "submitted" }]);
        await tx.insert(schema.matchRosterPlayers).values(roster.map(member => ({ rosterId: member.entryId === base.entryAId ? a : b, eventRosterMemberId: member.eventRosterMemberId, isStarter: true })));
        const effective = roster.map(member => ({ ...member, matchId, rosterId: member.entryId === base.entryAId ? a : b }));
        for (const order of [1, 2]) {
          const [map] = await tx.insert(schema.matchMaps).values({ matchId, mapOrder: order, mapName: "de_ancient", scoreA: 13, scoreB: 9, completedAt }).returning();
          const evidence = parseRivalHubDemoEvidenceV1(JSON.parse(encoded));
          evidence.target = { ...evidence.target, seasonId: base.seasonId!, matchId, matchMapId: map!.id, stageKey: base.stage,
            stageRunId: undefined, mapOrder: order, expectedMapName: "de_ancient", entryAId: base.entryAId!, entryBId: base.entryBId!,
            evidenceRevision: buildEvidenceRevisionForTarget({ match: match!, map: map!, roster: effective }) };
          const payloadSha256 = createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
          const [row] = await tx.insert(schema.matchDemoImports).values({ seasonId: base.seasonId!, matchId, matchMapId: map!.id, stageKey: base.stage,
            demoSha256: evidence.source.demoSha256, payloadSha256, contractVersion: "rivalhub-demo-evidence/1",
            semanticProfile: evidence.contract.semanticProfile, analysisVersion: evidence.contract.analysisVersion, evidenceRevision: evidence.target.evidenceRevision!,
            status: "confirmed", payload: evidence, submittedByPairingId: pairingId, confirmedAt: completedAt }).returning();
          await promoteDemoImportInTx({ actorId: "local-resource-fixture", verifiedBy: "canonical-local-fixture", auditAction: "match.demo.auto_confirm", retryPromotion: false, tx, row: row!, evidence, target: { match, map: map!, roster: effective },
            resolutions: new Map(effective.map(member => [member.steam64!, { userId: member.userId, source: "primary" as const }])) });
          importIds.push(row!.id);
        }
      });
      matchIds.push(matchId); rosterIds.push(a, b);
      const [size] = await db.select({ rows: sql<number>`count(*)::int`, bytes: sql<string>`sum(octet_length(${schema.matchDemoStatProjections.facts}::text))::text` })
        .from(schema.matchDemoStatProjections).where(and(inArray(schema.matchDemoStatProjections.importId, importIds), eq(schema.matchDemoStatProjections.projectionVersion, STATISTICS_PROJECTION_VERSION)));
      projectionRows = size!.rows; projectionTextBytes = Number(size!.bytes);
    }
    if (projectionRows < 100 || projectionTextBytes < 4231115) throw new Error("CANONICAL_FIXTURE_BELOW_TARGET_SCALE");
    const stats = await getTournamentStats({ seasonId: base.seasonId, view: "overview", publicOnly: true });
    if (stats.coverage.detailedMaps !== projectionRows) throw new Error("CANONICAL_FIXTURE_NOT_PUBLICLY_ELIGIBLE");
    return { cleanup, seasonId: base.seasonId, playerId: roster[0]!.userId, playerName: "Resource Player 01",
      measurement: { projectionRows, projectionTextBytes, uniquePlayers: 10, matches: matchIds.length,
        sourceSha256: createHash("sha256").update(source).digest("hex"),
        logicalFixtureHash: createHash("sha256").update(JSON.stringify({ sourceSha256: createHash("sha256").update(source).digest("hex"), projectionRows, projectionTextBytes, uniquePlayers: 10, completedAt: "2026-09-28T00:30:00Z", format: "bo3", mapsPerMatch: 2 })).digest("hex") } };
  } catch (error) { await cleanup(); throw error; }
}
