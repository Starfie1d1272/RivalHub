import { getTeamDirectory } from "@/lib/teams/directory";
import { normalizeTeamDirectoryQuery } from "@/lib/teams/directory-contract";
import { getPublicTeamProfileBasics, getPublicTeamProfileCore, getPublicTeamProfileLink } from "@/lib/teams/public-profile";
import { compilePlayerAttributeBenchmark } from "@/lib/stats/player-attributes";
import { publicStatsView } from "@/lib/stats/public-view";
import { parseStatsQuery, STATS_TABS } from "@/lib/stats/view-state";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Client, type PoolClient } from "pg";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { buildTournamentAnalytics, buildTournamentPerformanceAnalytics } from "@cs2dak/tournament";
import { describe, expect, it, vi } from "vitest";
import { extractPgError } from "../../../src/db/errors";
import { actionError } from "../../../src/lib/action-utils";
import * as schema from "../../../src/db/schema";
import { clearOperatorScoreboardInTx, loadOperatorScoreboard, loadScoreboardPlayers } from "../../../src/lib/matches/operator-scoreboard";
import { loadAdminDemoReview } from "../../../src/lib/admin/matches/demo-review";
import { projectAdminDemoQuality } from "../../../src/lib/admin/matches/demo-quality";
import { loadCanonicalTarget } from "../../../src/lib/demo-integration/validation";
import { ErrorCode } from "../../../src/lib/errors";
import * as demoEvidenceContract from "../../../src/lib/demo-evidence/contract";
import type { RivalHubEvidenceSubmission } from "../../../src/lib/demo-integration/contracts";
import { lockDemoImportLineageInTx } from "../../../src/lib/demo-integration/promotion";
import { revalidateSeasonNeedsAttentionImports, revalidateStoredDemoImportInTx } from "../../../src/lib/demo-integration/revalidation";
import { readRivalHubEvents } from "../../../src/lib/demo-integration/read";
import { buildEvidenceRevision, buildEvidenceRevisionForTarget, sha256Json } from "../../../src/lib/demo-integration/revision";
import {
  confirmStoredDemoParticipantIdentityInTx,
  GAMEPLAY_STEAM_CONFLICT_MESSAGE,
  rejectStoredDemoImportInTx,
  retireSeasonGameplaySteamIdentityInTx,
} from "../../../src/lib/demo-integration/review";
import { dakStableScoreboardValues, submitRivalHubEvidence } from "../../../src/lib/demo-integration/submit";
import { recordGameplaySteamIdentityInTx } from "../../../src/lib/identity/gameplay-steam";
import { getCurrentStatsSelectionInTx, getMatchMvpSummary, getTournamentPerformancePopulations, getLongTeamCareerDetail, getPlayerCareerDetail, getPlayerCareerPerformances, getTournamentTeamDetail, getTournamentMapDetail, getTournamentPerformancePlayers, getTournamentPlayerDetail, getTournamentStats, getTournamentRecordEvents } from "../../../src/lib/stats/tournament-query";
import { adaptStatsEvidence } from "../../../src/lib/stats/evidence-adapter";
import { loadLineupCareers, loadLineupPopulation } from "../../../src/lib/matches/lineup-comparison-query";
import { partitionRankingPopulation } from "../../../src/lib/stats/ranking";
import { getStatsLeaderboard } from "../../../src/lib/stats/leaderboard-query";
import { getVerifiedPlayerStatsBySeason } from "../../../src/lib/stats/public-query";
import { encodePerformanceTransport } from "../../../src/lib/stats/projection-transport";
import { PREVIOUS_STATISTICS_PROJECTION_VERSION, STATISTICS_PROJECTION_VERSION } from "../../../src/lib/stats/projection-version";
import { backfillStatisticsProjectionForMapInTx, backfillStatisticsTransport, inspectStatisticsProjectionCoverage, reconcileMissingStatisticsProjections } from "../../../src/lib/stats/projection-backfill";
import { invalidateConfirmedDemoIdentityInTx } from "../../../src/lib/identity/statistics-invalidation";
import { createLocalPool } from "./harness/database";

const fixturePath = resolve(process.cwd(), "tests/fixtures/demo-evidence/normal-map-v1.json");

async function waitForAdvisoryWait(observer: PoolClient, pid: number): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const result = await observer.query<{ wait_event: string | null }>("SELECT wait_event FROM pg_stat_activity WHERE pid = $1", [pid]);
    if (result.rows[0]?.wait_event === "advisory") return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Concurrent workflow did not wait for the identity advisory lock");
}


describe("DAK evidence submit persistence", () => {
  it("serializes mutable Demo workflows on the same map before row locks", async () => {
    const pool = createLocalPool();
    const first = await pool.connect();
    const second = await pool.connect();
    const mapId = randomUUID();
    const firstDb = drizzle(first, { schema });
    try {
      await first.query("BEGIN");
      await lockDemoImportLineageInTx(
        firstDb as unknown as Parameters<typeof lockDemoImportLineageInTx>[0],
        mapId,
      );

      await second.query("BEGIN");
      const whileHeld = await second.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked",
        [`demo-map:${mapId}`],
      );
      expect(whileHeld.rows[0]?.locked).toBe(false);

      await first.query("COMMIT");
      const afterRelease = await second.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked",
        [`demo-map:${mapId}`],
      );
      expect(afterRelease.rows[0]?.locked).toBe(true);
    } finally {
      await first.query("ROLLBACK").catch(() => {});
      await second.query("ROLLBACK").catch(() => {});
      first.release();
      second.release();
      await pool.end();
    }
  });

  it("adopts a submitted 10-player roster despite OCR scoreboard drift and preserves OCR-owned stats", async () => {
    const pool = createLocalPool();
    const client = await pool.connect();
    const database = drizzle(client, { schema });
    const queryLog: string[] = [];
    const queryBindings: unknown[][] = [];
    const observedDatabase = drizzle(client, { schema, logger: { logQuery: (query, params) => { queryLog.push(query); queryBindings.push(params); } } });
    async function checkDetailProjection<T>(owner: () => Promise<T>) {
      queryLog.length = 0;
      queryBindings.length = 0;
      return owner();
    }
    const ids = {
      season: randomUUID(),
      entryA: randomUUID(),
      entryB: randomUUID(),
      revisionA: randomUUID(),
      revisionB: randomUUID(),
      eventRosterA: randomUUID(),
      eventRosterB: randomUUID(),
      match: randomUUID(),
      map: randomUUID(),
      mixedMatch: randomUUID(),
      mixedRosterA: randomUUID(),
      mixedRosterB: randomUUID(),
      mixedMap: randomUUID(),
      mixedImport: randomUUID(),
      rosterA: randomUUID(),
      rosterB: randomUUID(),
      pairingIntent: randomUUID(),
      pairing: randomUUID(),
      ocrStat: randomUUID(),
      legacyImport: randomUUID(),
      careerSeason: randomUUID(),
      careerEntryA: randomUUID(),
      careerEntryB: randomUUID(),
      careerRevisionA: randomUUID(),
      careerRevisionB: randomUUID(),
      careerEventRosterA: randomUUID(),
      careerEventRosterB: randomUUID(),
      careerMatch: randomUUID(),
      careerMap: randomUUID(),
      careerRosterA: randomUUID(),
      careerRosterB: randomUUID(),
    };
    const userIds = Array.from({ length: 10 }, () => randomUUID());
    const participantIds = userIds.map(() => randomUUID());
    const eventMemberIds = userIds.map(() => randomUUID());
    const rosterMemberIds = userIds.map(() => randomUUID());
    const careerParticipantIds = userIds.map(() => randomUUID());
    const careerEventMemberIds = userIds.map(() => randomUUID());
    const careerRosterMemberIds = userIds.map(() => randomUUID());
    const now = new Date("2026-09-13T05:00:00.000Z");
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
    try {
      await client.query("BEGIN");
      await database.insert(schema.users).values(userIds.map((id, index) => ({
        id,
        email: `${id}@local.test`,
        steam64: `765611980000000${String(index + 1).padStart(2, "0")}`,
      })));
      await database.insert(schema.seasons).values({
        id: ids.season,
        slug: ids.season,
        name: "DAK evidence retry",
        kind: "custom",
        status: "playing",
      });
      await database.insert(schema.competitionEntries).values([
        {
          id: ids.entryA,
          competitionId: ids.season,
          source: "event_native",
          name: "Canonical A",
          representativeUserId: userIds[0]!,
          registrationStatus: "approved",
          currentRosterRevisionId: ids.revisionA,
          approvedRosterRevisionId: ids.revisionA,
        },
        {
          id: ids.entryB,
          competitionId: ids.season,
          source: "event_native",
          name: "Canonical B",
          representativeUserId: userIds[5]!,
          registrationStatus: "approved",
          currentRosterRevisionId: ids.revisionB,
          approvedRosterRevisionId: ids.revisionB,
        },
      ]);
      await database.insert(schema.competitionEntryRepresentativeChanges).values([
        { entryId: ids.entryA, fromUserId: null, toUserId: userIds[0]!, changedByActorId: "integration-test" },
        { entryId: ids.entryB, fromUserId: null, toUserId: userIds[5]!, changedByActorId: "integration-test" },
      ]);
      await database.insert(schema.competitionEntryRosterRevisions).values([
        { id: ids.revisionA, entryId: ids.entryA, revisionNumber: 1, status: "approved", createdBy: userIds[0]!, approvedAt: now },
        { id: ids.revisionB, entryId: ids.entryB, revisionNumber: 1, status: "approved", createdBy: userIds[5]!, approvedAt: now },
      ]);
      await database.insert(schema.competitionEntryParticipants).values(userIds.map((userId, index) => ({
        id: participantIds[index]!,
        entryId: index < 5 ? ids.entryA : ids.entryB,
        userId,
        status: "confirmed" as const,
        invitedByUserId: index < 5 ? userIds[0]! : userIds[5]!,
        confirmedAt: now,
      })));
      await database.insert(schema.competitionEntryRosterMembers).values(userIds.map((userId, index) => ({
        id: rosterMemberIds[index]!,
        revisionId: index < 5 ? ids.revisionA : ids.revisionB,
        participantId: participantIds[index]!,
        userId,
        isPrimaryStarter: true,
      })));
      await database.insert(schema.eventRosters).values([
        { id: ids.eventRosterA, entryId: ids.entryA, sourceRosterRevisionId: ids.revisionA, status: "confirmed", confirmedAt: now, confirmedBy: userIds[0]! },
        { id: ids.eventRosterB, entryId: ids.entryB, sourceRosterRevisionId: ids.revisionB, status: "confirmed", confirmedAt: now, confirmedBy: userIds[5]! },
      ]);
      await database.insert(schema.eventRosterMembers).values(userIds.map((userId, index) => ({
        id: eventMemberIds[index]!,
        eventRosterId: index < 5 ? ids.eventRosterA : ids.eventRosterB,
        userId,
        participantId: participantIds[index]!,
        isPrimaryStarter: true,
      })));
      await database.insert(schema.matches).values({
        id: ids.match,
        seasonId: ids.season,
        entryAId: ids.entryA,
        entryBId: ids.entryB,
        stage: "fixture-stage",
        format: "bo1",
        scoreA: 1,
        scoreB: 0,
        status: "finished",
        completedAt: now,
      });
      await database.insert(schema.matchMaps).values({
        id: ids.map,
        matchId: ids.match,
        mapOrder: 1,
        mapName: "de_ancient",
        scoreA: 13,
        scoreB: 9,
        completedAt: now,
      });
      await database.insert(schema.matchRosters).values([
        { id: ids.rosterA, matchId: ids.match, entryId: ids.entryA, source: "admin_select", status: "submitted" },
        { id: ids.rosterB, matchId: ids.match, entryId: ids.entryB, source: "admin_select", status: "submitted" },
      ]);
      await database.insert(schema.matchRosterPlayers).values(userIds.map((userId, index) => ({
        rosterId: index < 5 ? ids.rosterA : ids.rosterB,
        eventRosterMemberId: eventMemberIds[index]!,
        isStarter: true,
      })));
      await database.insert(schema.dakPairingIntents).values({
        id: ids.pairingIntent,
        pollTokenHash: randomUUID(),
        status: "authorized",
        authorizedByUserId: userIds[0]!,
        expiresAt,
        authorizedAt: now,
      });
      await database.insert(schema.dakPairings).values({
        id: ids.pairing,
        pairingIntentId: ids.pairingIntent,
        userId: userIds[0]!,
        tokenHash: randomUUID(),
        scopes: ["event:read", "demo:submit"],
        seasonIds: [ids.season],
      });

      const fixture = demoEvidenceContract.parseRivalHubDemoEvidenceV1(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown);
      const targetWithoutStageRun = { ...fixture.target };
      delete targetWithoutStageRun.stageRunId;
      const evidence: RivalHubEvidenceSubmission = {
        ...fixture,
        target: {
          ...targetWithoutStageRun,
          seasonId: ids.season,
          matchId: ids.match,
          matchMapId: ids.map,
          entryAId: ids.entryA,
          entryBId: ids.entryB,
        },
        participants: fixture.participants.map((participant, index) => ({
          ...participant,
          resolution: {
            status: "matched" as const,
            userId: userIds[index]!,
            eventRosterMemberId: eventMemberIds[index]!,
            entryId: index < 5 ? ids.entryA : ids.entryB,
          },
        })),
      };
      evidence.target.evidenceRevision = buildEvidenceRevision({
        seasonId: ids.season,
        stageKey: "fixture-stage",
        stageRunId: null,
        matchId: ids.match,
        matchMapId: ids.map,
        mapOrder: 1,
        mapName: "de_ancient",
        mapScoreA: 13,
        mapScoreB: 9,
        mapCompletedAt: now.toISOString(),
        matchStatus: "finished",
        entryAId: ids.entryA,
        entryBId: ids.entryB,
        roster: userIds.map((userId, index) => ({
          entryId: index < 5 ? ids.entryA : ids.entryB,
          eventRosterMemberId: eventMemberIds[index]!,
          userId,
          steam64: `765611980000000${String(index + 1).padStart(2, "0")}`,
          isStarter: true,
        })),
      });
      const legacyEvidence = demoEvidenceContract.parseRivalHubDemoEvidenceV1({
        ...evidence,
        contract: {
          ...evidence.contract,
          semanticProfile: "dak-stable/2",
          analysisVersion: "cs2-demo-analysis-kit/1.0.2",
        },
      });
      const historicalConfirmedAt = new Date(now.getTime() - 1_000);
      await database.insert(schema.matchDemoImports).values({
        id: ids.legacyImport,
        seasonId: ids.season,
        matchId: ids.match,
        matchMapId: ids.map,
        stageKey: "fixture-stage",
        stageRunId: null,
        demoSha256: legacyEvidence.source.demoSha256,
        payloadSha256: sha256Json(legacyEvidence),
        contractVersion: legacyEvidence.contract.contractVersion,
        semanticProfile: legacyEvidence.contract.semanticProfile,
        analysisVersion: legacyEvidence.contract.analysisVersion,
        evidenceRevision: legacyEvidence.target.evidenceRevision,
        status: "confirmed",
        payload: legacyEvidence,
        submittedByPairingId: ids.pairing,
        idempotencyKey: "dak-legacy-confirmed-production-1",
        supersedesImportId: null,
        issues: [],
        submittedAt: historicalConfirmedAt,
        confirmedAt: historicalConfirmedAt,
        createdAt: historicalConfirmedAt,
      });
      await database.insert(schema.matchPlayerStats).values({
        id: ids.ocrStat,
        matchId: ids.match,
        mapId: ids.map,
        perfectName: "OCR display name",
        userId: userIds[0]!,
        kills: evidence.summaries.playerMaps[0]!.kills + 1,
        deaths: evidence.summaries.playerMaps[0]!.deaths + 1,
        assists: evidence.summaries.playerMaps[0]!.assists + 1,
        hsPercent: dakStableScoreboardValues(evidence.summaries.playerMaps[0]!).hsPercent + 1,
        firstKills: evidence.summaries.playerMaps[0]!.firstKills + 1,
        multiKills: dakStableScoreboardValues(evidence.summaries.playerMaps[0]!).multiKills + 1,
        clutches: dakStableScoreboardValues(evidence.summaries.playerMaps[0]!).clutches + 1,
        adr: dakStableScoreboardValues(evidence.summaries.playerMaps[0]!).adr + 1,
        rws: 7.5,
        ratingPro: 1.25,
        we: 8,
      });
      await client.query("COMMIT");

      const remote = await readRivalHubEvents({ seasonIds: [ids.season] });
      const remoteMap = remote.events[0]?.series[0]?.maps[0];
      expect(remoteMap?.lineup).toHaveLength(10);
      expect(remoteMap?.lineup.every((player) => player.isStarter)).toBe(true);
      expect(remoteMap?.evidenceRevision).toBe(evidence.target.evidenceRevision);

      const legacyRetry = await submitRivalHubEvidence({
        input: legacyEvidence,
        pairingId: ids.pairing,
        pairingScope: { seasonIds: [ids.season] },
        idempotencyKey: "dak-legacy-confirmed-retry-1",
      });
      expect(legacyRetry.status).toBe("needs_attention");
      expect(legacyRetry.importId).toBe(ids.legacyImport);
      expect(legacyRetry.issues).toEqual([
        expect.objectContaining({ code: "UNSUPPORTED_SEMANTIC_PROFILE" }),
      ]);
      expect(await database.select().from(schema.matchDemoImports).where(eq(schema.matchDemoImports.id, ids.legacyImport))).toMatchObject([
        expect.objectContaining({ status: "confirmed", semanticProfile: "dak-stable/2" }),
      ]);
      expect(await database.select().from(schema.matchDemoImports).where(eq(schema.matchDemoImports.matchMapId, ids.map))).toHaveLength(1);
      expect(await database.select().from(schema.matchRoundFacts).where(eq(schema.matchRoundFacts.importId, ids.legacyImport))).toHaveLength(0);

      const conflictingBeforePromotion: RivalHubEvidenceSubmission = {
        ...evidence,
        source: { ...evidence.source, demoSha256: "c".repeat(64) },
      };
      const conflictBeforePromotion = await submitRivalHubEvidence({
        input: conflictingBeforePromotion,
        pairingId: ids.pairing,
        pairingScope: { seasonIds: [ids.season] },
        idempotencyKey: "dak-legacy-confirmed-conflict-1",
      });
      expect(conflictBeforePromotion.status).toBe("needs_attention");
      expect(conflictBeforePromotion.issues.some((row) => row.code === "CONTENT_CONFLICT")).toBe(true);
      const conflictBeforePromotionId = conflictBeforePromotion.importId;
      expect(conflictBeforePromotionId).not.toBeNull();
      if (!conflictBeforePromotionId) throw new Error("测试未创建历史 Demo 冲突记录");
      expect(await database.select().from(schema.matchDemoImports).where(eq(schema.matchDemoImports.id, ids.legacyImport))).toMatchObject([
        expect.objectContaining({ status: "confirmed", semanticProfile: "dak-stable/2" }),
      ]);

      expect((await getTournamentStats({ seasonId: ids.season }, database)).analytics.totals.mapCount).toBe(0);
      const first = await submitRivalHubEvidence({
        input: evidence,
        pairingId: ids.pairing,
        pairingScope: { seasonIds: [ids.season] },
        idempotencyKey: "dak-retry-evidence-1",
      });
      expect(first).toMatchObject({ status: "synced", issues: [] });
      const importId = first.importId;
      expect(importId).not.toBeNull();
      if (!importId) throw new Error("测试未创建 Demo import");
      expect(importId).not.toBe(ids.legacyImport);

      const second = await submitRivalHubEvidence({
        input: evidence,
        pairingId: ids.pairing,
        pairingScope: { seasonIds: [ids.season] },
        idempotencyKey: "dak-retry-evidence-1",
      });
      expect(second).toMatchObject({ status: "synced", importId, issues: [] });

      const importsAfterPromotion = await database.select().from(schema.matchDemoImports).where(eq(schema.matchDemoImports.matchMapId, ids.map));
      expect(importsAfterPromotion).toHaveLength(3);
      expect(importsAfterPromotion.find((row) => row.id === ids.legacyImport)).toMatchObject({ status: "superseded" });
      expect(importsAfterPromotion.find((row) => row.id === conflictBeforePromotionId)).toMatchObject({ status: "needs_attention", demoSha256: "c".repeat(64) });
      expect(importsAfterPromotion.find((row) => row.id === importId)).toMatchObject({
        status: "confirmed",
        semanticProfile: "dak-stable/3",
        analysisVersion: "cs2-demo-analysis-kit/1.0.3",
        evidenceRevision: legacyEvidence.target.evidenceRevision,
        demoSha256: legacyEvidence.source.demoSha256,
        idempotencyKey: "dak-retry-evidence-1",
        issues: [],
        supersedesImportId: ids.legacyImport,
      });
      expect(importsAfterPromotion.find((row) => row.id === importId)?.confirmedAt).not.toBeNull();
      expect(importsAfterPromotion.find((row) => row.id === ids.legacyImport)?.payloadSha256).not.toBe(importsAfterPromotion.find((row) => row.id === importId)?.payloadSha256);
      const allProjections = await database.select().from(schema.matchDemoStatProjections).where(eq(schema.matchDemoStatProjections.importId, importId));
      const projectionsAfterPromotion = allProjections.filter(row => row.projectionVersion === STATISTICS_PROJECTION_VERSION);
      expect(projectionsAfterPromotion).toHaveLength(1);
      const legacyProjection = allProjections.find(row => row.projectionVersion === PREVIOUS_STATISTICS_PROJECTION_VERSION);
      expect(legacyProjection?.facts.records).not.toHaveProperty("events");
      expect(legacyProjection?.facts.records?.candidates.every(row => ["kills", "adr", "firstKills", "tradeKills", "clutch", "economy"].includes(row.kind))).toBe(true);
      expect(projectionsAfterPromotion[0]).toMatchObject({
        projectionVersion: STATISTICS_PROJECTION_VERSION,
        payloadSha256: sha256Json(evidence),
        evidenceRevision: evidence.target.evidenceRevision,
      });
      expect(projectionsAfterPromotion[0]?.identityBindings).toHaveLength(10);
      expect(projectionsAfterPromotion[0]?.facts.performance).not.toHaveProperty("playerRounds");

      // A missing or older projection lowers coverage without a payload fallback.
      await database.delete(schema.matchDemoStatProjections).where(eq(schema.matchDemoStatProjections.importId, importId));
      queryLog.length = 0;
      queryBindings.length = 0;
      expect((await getTournamentStats({ seasonId: ids.season }, observedDatabase)).coverage.detailedMaps).toBe(0);
      expect(await getTournamentRecordEvents({ seasonId: ids.season }, {}, observedDatabase)).toMatchObject({ maps: 0, total: 0, rows: [] });
      expect(await getTournamentPerformancePlayers({ seasonId: ids.season }, observedDatabase)).toEqual([]);
      expect(await getMatchMvpSummary(ids.match, userIds[0]!, observedDatabase)).toBeNull();
      expect(queryLog.some((query) => /from "match_demo_imports"/i.test(query) && query.includes('"payload"'))).toBe(false);
      await database.insert(schema.matchDemoStatProjections).values({ ...projectionsAfterPromotion[0]!, projectionVersion: "retired-version" });
      queryLog.length = 0;
      queryBindings.length = 0;
      expect((await getTournamentStats({ seasonId: ids.season }, observedDatabase)).coverage.detailedMaps).toBe(0);
      expect(await getTournamentPerformancePlayers({ seasonId: ids.season }, observedDatabase)).toEqual([]);
      expect(queryLog.some((query) => /from "match_demo_imports"/i.test(query) && query.includes('"payload"'))).toBe(false);
      await expect(database.transaction((tx) => backfillStatisticsProjectionForMapInTx(tx, ids.map, false))).resolves.toBe("missing");
      await expect(database.transaction((tx) => backfillStatisticsProjectionForMapInTx(tx, ids.map, true))).resolves.toBe("rebuilt");
      queryLog.length = 0;
      queryBindings.length = 0;
      await expect(observedDatabase.transaction((tx) => backfillStatisticsProjectionForMapInTx(tx, ids.map, true))).resolves.toBe("unchanged");
      expect(queryLog.some((query) => /from "match_demo_imports"/i.test(query) && query.includes('"payload"'))).toBe(false);
      const [rebuiltProjection] = await database.select().from(schema.matchDemoStatProjections).where(and(
        eq(schema.matchDemoStatProjections.importId, importId), eq(schema.matchDemoStatProjections.projectionVersion, STATISTICS_PROJECTION_VERSION),
      ));
      expect(rebuiltProjection?.facts).toEqual(projectionsAfterPromotion[0]?.facts);
      // Existing current and previous rows are independently encoded under the
      // lineage lock; an old writer may legally strip the sidecar again.
      const previousFacts = legacyProjection!.facts;
      const previousPerformance = { ...previousFacts.performance, data: { ...previousFacts.performance.data as object, backfillProbe: "previous-only" } };
      await database.update(schema.matchDemoStatProjections).set({ facts: sql`${schema.matchDemoStatProjections.facts} - 'performanceTransport'` })
        .where(eq(schema.matchDemoStatProjections.importId, importId));
      await database.update(schema.matchDemoStatProjections).set({ facts: { ...previousFacts, performance: previousPerformance, performanceTransport: undefined } })
        .where(and(eq(schema.matchDemoStatProjections.importId, importId), eq(schema.matchDemoStatProjections.projectionVersion, PREVIOUS_STATISTICS_PROJECTION_VERSION)));
      expect(await backfillStatisticsTransport(database, { apply: false })).toMatchObject({ scanned: 1, legacy_retained: 1, complete: true });
      expect(await backfillStatisticsTransport(database, { apply: true })).toMatchObject({ scanned: 1, encoded: 2, invalid: 0, complete: true });
      const transportedRows = await database.select().from(schema.matchDemoStatProjections).where(inArray(schema.matchDemoStatProjections.projectionVersion, [STATISTICS_PROJECTION_VERSION, PREVIOUS_STATISTICS_PROJECTION_VERSION]));
      const previousTransport = transportedRows.find(row => row.projectionVersion === PREVIOUS_STATISTICS_PROJECTION_VERSION)!;
      const currentTransport = transportedRows.find(row => row.projectionVersion === STATISTICS_PROJECTION_VERSION)!;
      expect(previousTransport.facts.performance).toEqual(previousPerformance);
      expect(previousTransport.facts.performanceTransport).not.toEqual(currentTransport.facts.performanceTransport);
      expect(await backfillStatisticsTransport(database, { apply: true })).toMatchObject({ already: 2, invalid: 0 });
      await database.update(schema.matchDemoStatProjections).set({ facts: sql`jsonb_set(${schema.matchDemoStatProjections.facts}, '{performanceTransport}', 'null'::jsonb)` })
        .where(and(eq(schema.matchDemoStatProjections.importId, importId), eq(schema.matchDemoStatProjections.projectionVersion, PREVIOUS_STATISTICS_PROJECTION_VERSION)));
      expect(await backfillStatisticsTransport(database, { apply: true })).toMatchObject({ invalid: 1, complete: false });
      await database.update(schema.matchDemoStatProjections).set({ facts: previousFacts })
        .where(and(eq(schema.matchDemoStatProjections.importId, importId), eq(schema.matchDemoStatProjections.projectionVersion, PREVIOUS_STATISTICS_PROJECTION_VERSION)));
      await database.update(schema.matchDemoStatProjections).set({ facts: rebuiltProjection!.facts })
        .where(and(eq(schema.matchDemoStatProjections.importId, importId), eq(schema.matchDemoStatProjections.projectionVersion, STATISTICS_PROJECTION_VERSION)));
      // A legacy writer and a correction both hold the canonical lineage lock.
      // The backfill must wait, then act on the committed facts/target.
      const holder = await pool.connect();
      const worker = await pool.connect();
      const holderDb = drizzle(holder, { schema });
      const workerDb = drizzle(worker, { schema });
      const workerPid = (await worker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      let pendingTransport: Promise<unknown> | undefined;
      try {
        for (const scenario of ["legacy-writer", "correction"] as const) {
          await holder.query("BEGIN");
          await lockDemoImportLineageInTx(holderDb as unknown as Parameters<typeof lockDemoImportLineageInTx>[0], ids.map);
          if (scenario === "legacy-writer") await holderDb.update(schema.matchDemoStatProjections)
            .set({ facts: sql`${schema.matchDemoStatProjections.facts} - 'performanceTransport'` })
            .where(and(eq(schema.matchDemoStatProjections.importId, importId), eq(schema.matchDemoStatProjections.projectionVersion, STATISTICS_PROJECTION_VERSION)));
          else await holderDb.update(schema.matchMaps).set({ completedAt: new Date(now.getTime() + 1000) }).where(eq(schema.matchMaps.id, ids.map));
          const operation = backfillStatisticsTransport(workerDb, { apply: true });
          pendingTransport = operation;
          void operation.catch(() => undefined);
          await waitForAdvisoryWait(client, workerPid);
          await holder.query("COMMIT");
          expect(await operation).toMatchObject(scenario === "legacy-writer" ? { encoded: 1, invalid: 0 } : { not_current: 1, invalid: 0 });
          pendingTransport = undefined;
          if (scenario === "correction") await database.update(schema.matchMaps).set({ completedAt: now }).where(eq(schema.matchMaps.id, ids.map));
        }
      } finally {
        await holder.query("ROLLBACK").catch(() => {});
        await pendingTransport?.catch(() => undefined);
        holder.release(); worker.release();
      }
      await database.update(schema.matchDemoStatProjections).set({ facts: rebuiltProjection!.facts })
        .where(and(eq(schema.matchDemoStatProjections.importId, importId), eq(schema.matchDemoStatProjections.projectionVersion, STATISTICS_PROJECTION_VERSION)));
      await expect(database.transaction(async (tx) => {
        await tx.delete(schema.matchDemoStatProjections).where(eq(schema.matchDemoStatProjections.importId, importId));
        await backfillStatisticsProjectionForMapInTx(tx, ids.map, true);
        throw new Error("projection-rollback-probe");
      })).rejects.toThrow("projection-rollback-probe");
      expect((await database.select().from(schema.matchDemoStatProjections).where(and(
        eq(schema.matchDemoStatProjections.importId, importId), eq(schema.matchDemoStatProjections.projectionVersion, STATISTICS_PROJECTION_VERSION),
      )))[0]).toEqual(rebuiltProjection);
      queryLog.length = 0;
      queryBindings.length = 0;
      const selection = await observedDatabase.transaction((tx) => getCurrentStatsSelectionInTx(tx, { seasonId: ids.season }));
      expect(selection.currentImportIds).toEqual([importId]);
      // Execute the owner query against real rows: both match AND user must match.
      const partialRoster = selection.roster.filter(row => row.userId === userIds[0] || row.userId === userIds[1])
        .map(row => row.userId === userIds[1] ? { ...row, matchId: randomUUID() } : row);
      const leaderboardOptions = { requireCurrentImports: true, groupByTeam: false };
      const restricted = await getStatsLeaderboard({ seasonId: ids.season }, [importId], partialRoster, database, { ...leaderboardOptions, requireRosterMatch: true });
      expect(restricted.map(row => row.userId)).toEqual([userIds[0]]);
      expect(await getStatsLeaderboard({ seasonId: ids.season }, [], selection.roster, database, leaderboardOptions)).toEqual([]);
      expect((await getVerifiedPlayerStatsBySeason(ids.season, [userIds[0]!])).get(userIds[0]!)?.maps).toBe(1);
      await database.update(schema.matches).set({ status: "in_progress" }).where(eq(schema.matches.id, ids.match));
      try {
        expect(await getStatsLeaderboard({ seasonId: ids.season }, [importId], selection.roster, database, leaderboardOptions)).toHaveLength(10);
        expect(await getVerifiedPlayerStatsBySeason(ids.season, [userIds[0]!])).toEqual(new Map());
        await database.update(schema.matchMaps).set({ completedAt: null }).where(eq(schema.matchMaps.id, ids.map));
        expect(await getStatsLeaderboard({ seasonId: ids.season }, [importId], selection.roster, database, leaderboardOptions)).toEqual([]);
      } finally {
        await database.update(schema.matchMaps).set({ completedAt: now }).where(eq(schema.matchMaps.id, ids.map));
        await database.update(schema.matches).set({ status: "finished" }).where(eq(schema.matches.id, ids.match));
      }

      expect(queryLog.some((query) => /"payload"|"facts"/.test(query))).toBe(false);
      // The worker quarantines only proven source/canonical issues; the release
      // tool remains fail-closed, and invalid imports stop being rebuild targets.
      await expect(database.transaction(async (tx) => {
        await tx.delete(schema.matchDemoStatProjections).where(eq(schema.matchDemoStatProjections.importId, importId));
        await tx.update(schema.matchDemoImports).set({ payloadSha256: "0".repeat(64) }).where(eq(schema.matchDemoImports.id, importId));
        await expect(backfillStatisticsProjectionForMapInTx(tx, ids.map, true)).rejects.toThrow("source integrity failed");
        expect((await tx.select({ status: schema.matchDemoImports.status }).from(schema.matchDemoImports).where(eq(schema.matchDemoImports.id, importId)))[0]?.status).toBe("confirmed");
        await expect(backfillStatisticsProjectionForMapInTx(tx, ids.map, true, { quarantineInvalid: true })).resolves.toBe("invalid");
        expect((await tx.select({ status: schema.matchDemoImports.status }).from(schema.matchDemoImports).where(eq(schema.matchDemoImports.id, importId)))[0]?.status).toBe("needs_attention");
        expect((await tx.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.action, "match.demo.recheck"), eq(schema.auditLogs.targetId, importId)))).some((row) => row.actorId === "system:statistics-projection")).toBe(true);
        await expect(backfillStatisticsProjectionForMapInTx(tx, ids.map, true, { quarantineInvalid: true })).resolves.toBe("not_current");
        throw new Error("invalid-projection-rollback-probe");
      })).rejects.toThrow("invalid-projection-rollback-probe");
      await expect(database.transaction(async (tx) => {
        await invalidateConfirmedDemoIdentityInTx(tx, { userId: randomUUID() });
        expect((await tx.select({ status: schema.matchDemoImports.status }).from(schema.matchDemoImports).where(eq(schema.matchDemoImports.id, importId)))[0]?.status).toBe("confirmed");
        await invalidateConfirmedDemoIdentityInTx(tx, { userId: userIds[0]! });
        expect((await tx.select({ status: schema.matchDemoImports.status }).from(schema.matchDemoImports).where(eq(schema.matchDemoImports.id, importId)))[0]?.status).toBe("needs_attention");
        throw new Error("identity-projection-rollback-probe");
      })).rejects.toThrow("identity-projection-rollback-probe");
      const factsAfterPromotion = await database.select().from(schema.matchRoundFacts).where(eq(schema.matchRoundFacts.importId, importId));
      expect(factsAfterPromotion).toHaveLength(evidence.sourceFacts.rounds.length);
      expect((await database.select().from(schema.matchPlayerStats).where(eq(schema.matchPlayerStats.id, ids.ocrStat)))[0]).toMatchObject({
        perfectName: "Fixture Player 01",
        dakImportId: importId,
        rws: 7.5,
        ratingPro: 1.25,
        we: 8,
      });

      const third = await submitRivalHubEvidence({
        input: evidence,
        pairingId: ids.pairing,
        pairingScope: { seasonIds: [ids.season] },
        idempotencyKey: "dak-retry-evidence-1",
      });
      expect(third).toMatchObject({ status: "synced", importId, issues: [] });
      expect(await database.select().from(schema.matchDemoImports).where(eq(schema.matchDemoImports.matchMapId, ids.map))).toHaveLength(3);
      expect(await database.select().from(schema.matchRoundFacts).where(eq(schema.matchRoundFacts.importId, importId))).toHaveLength(factsAfterPromotion.length);
      const autoConfirmAudits = await database.select().from(schema.auditLogs).where(and(
        eq(schema.auditLogs.action, "match.demo.auto_confirm"),
        eq(schema.auditLogs.targetId, importId),
      ));
      expect(autoConfirmAudits).toHaveLength(1);
      expect(autoConfirmAudits[0]?.meta).toMatchObject({
        mapOrder: 1,
        playerCount: evidence.participants.length,
        rounds: evidence.sourceFacts.rounds.length,
      });

      queryLog.length = 0;
      queryBindings.length = 0;
      const stats = await getTournamentStats({ seasonId: ids.season }, observedDatabase);
      const importQueries = queryLog.filter((query) => /from "match_demo_imports"/i.test(query));
      expect(importQueries).toHaveLength(1);
      expect(importQueries.every((query) => !query.includes('"payload"'))).toBe(true);
      const projectionQuery = queryLog.find((query) => /from "match_demo_stat_projections"/i.test(query) && query.includes('"facts"'));
      expect(projectionQuery).toBeDefined();
      expect(queryBindings[queryLog.indexOf(projectionQuery!)]).toEqual([importId, STATISTICS_PROJECTION_VERSION]);
      expect(stats.coverage).toEqual({
        detailedMaps: 1,
        completedMaps: 1,
        maps: [{ mapName: "de_ancient", completedMaps: 1, detailedMaps: 1 }],
      });
      expect(stats.performance.players).toHaveLength(10);
      // Legacy readers remain valid after an old writer removes the sidecar;
      // a present null sidecar is corruption, never a fallback.
      await database.update(schema.matchDemoStatProjections).set({ facts: sql`${schema.matchDemoStatProjections.facts} - 'performanceTransport'` })
        .where(and(eq(schema.matchDemoStatProjections.importId, importId), eq(schema.matchDemoStatProjections.projectionVersion, STATISTICS_PROJECTION_VERSION)));
      expect(await getTournamentStats({ seasonId: ids.season }, observedDatabase)).toEqual(stats);
      await database.update(schema.matchDemoStatProjections).set({ facts: sql`jsonb_set(${schema.matchDemoStatProjections.facts}, '{performanceTransport}', 'null'::jsonb)` })
        .where(and(eq(schema.matchDemoStatProjections.importId, importId), eq(schema.matchDemoStatProjections.projectionVersion, STATISTICS_PROJECTION_VERSION)));
      await expect(getTournamentStats({ seasonId: ids.season }, observedDatabase)).rejects.toThrow("transport integrity failed");
      const wrongTarget = await encodePerformanceTransport({ ...rebuiltProjection!.facts.performance, matchKey: randomUUID() });
      expect(wrongTarget).not.toBeNull();
      await database.update(schema.matchDemoStatProjections).set({ facts: { ...rebuiltProjection!.facts, performanceTransport: wrongTarget! } })
        .where(and(eq(schema.matchDemoStatProjections.importId, importId), eq(schema.matchDemoStatProjections.projectionVersion, STATISTICS_PROJECTION_VERSION)));
      await expect(getTournamentStats({ seasonId: ids.season }, observedDatabase)).rejects.toThrow("transport integrity failed");
      await database.update(schema.matchDemoStatProjections).set({ facts: rebuiltProjection!.facts })
        .where(and(eq(schema.matchDemoStatProjections.importId, importId), eq(schema.matchDemoStatProjections.projectionVersion, STATISTICS_PROJECTION_VERSION)));
      // Demand-driven reads must preserve every visible value, using the same
      // current projections and complete population as the full legacy read.
      for (const tab of Object.keys(STATS_TABS) as Array<keyof typeof STATS_TABS>) {
        const query = parseStatsQuery({ tab }, []);
        const scoped = await getTournamentStats({ seasonId: ids.season, view: tab }, observedDatabase);
        expect(publicStatsView(scoped, query)).toEqual(publicStatsView(stats, query));
        if (tab !== "records") expect(scoped.recordTies).toBeUndefined();
        if (tab !== "overview") expect(scoped.insights).toBeUndefined();
      }
      expect(await getTournamentPerformancePopulations([ids.season], observedDatabase)).toEqual([stats.performance.players]);
      const winner = stats.performance.players[0]!;
      queryLog.length = 0;
      const mvp = await getMatchMvpSummary(ids.match, winner.player.entityKey, observedDatabase);
      expect(mvp).toEqual({ rounds: winner.slices.overall.sample.rounds, kast: winner.slices.overall.kast,
        tradeKillsPerRound: winner.slices.overall.trade.tradeKillsPerRound,
        utilityDamagePerRound: winner.slices.overall.utility.utilityDamagePerRound,
        flashAssistsPerRound: winner.slices.overall.utility.flashAssistsPerRound });
      expect(queryLog.some(query => query.includes('from "match_player_stats"'))).toBe(false);
      expect(await getMatchMvpSummary(ids.match, randomUUID(), observedDatabase)).toBeNull();


      queryLog.length = 0;
      queryBindings.length = 0;
      expect(await getTournamentPerformancePlayers({ seasonId: ids.season }, observedDatabase)).toEqual(stats.performance.players);
      expect(queryLog.some((query) => /from "match_demo_imports"/i.test(query) && query.includes('"payload"'))).toBe(false);
      await database.update(schema.matchDemoStatProjections).set({
        facts: { ...rebuiltProjection!.facts, tournament: { ...rebuiltProjection!.facts.tournament, matchKey: randomUUID() } },
      }).where(eq(schema.matchDemoStatProjections.importId, importId));
      try {
        await expect(getTournamentPerformancePlayers({ seasonId: ids.season }, observedDatabase)).rejects.toThrow("Statistics projection target mismatch");
      } finally {
        await database.update(schema.matchDemoStatProjections).set({ facts: rebuiltProjection!.facts })
          .where(eq(schema.matchDemoStatProjections.importId, importId));
      }
      expect(stats.analytics.teams).toHaveLength(2);
      expect(stats.analytics.maps[0]?.mapName).toBe("de_ancient");
      expect(stats.leaderboard).toHaveLength(10);
      expect(stats.leaderboard.every((row) => row.kast !== null && row.fdpr !== null && row.tradeKpr !== null)).toBe(true);
      const bindings = new Map(evidence.participants.map((participant, index) => [participant.steamId64, {
        userId: userIds[index]!,
        entryId: index < 5 ? ids.entryA : ids.entryB,
      }]));
      const expectedFacts = adaptStatsEvidence(evidence, bindings);
      const labels = {
        teams: Object.fromEntries(stats.analytics.teams.map((row) => [row.team.entityKey, row.team.displayName])),
        players: Object.fromEntries(stats.performance.players.map((row) => [row.player.entityKey, row.player.displayName])),
      };
      expect(stats.analytics).toEqual(buildTournamentAnalytics([expectedFacts.tournament], { labels }));
      expect(stats.performance).toEqual(buildTournamentPerformanceAnalytics([expectedFacts.performance], { labels }));

      queryLog.length = 0;
      queryBindings.length = 0;
      const mapDetail = await checkDetailProjection(() => getTournamentMapDetail({ seasonId: ids.season, map: "de_ancient" }, observedDatabase));
      expect(mapDetail).toMatchObject({
        map: "de_ancient",
        coverage: stats.coverage,
        results: stats.results,
        analytics: stats.analytics,
        performance: stats.performance,
        entries: stats.options.teams,
      });
      expect(queryLog.some((query) => query.includes("match_player_stats"))).toBe(false);
      expect(queryLog.some((query) => /from "match_maps" inner join "matches"/i.test(query) && query.includes('"map_name" ='))).toBe(true);
      expect(queryLog.some((query) => /from "matches"/i.test(query) && !/inner join "match_maps"/i.test(query))).toBe(false);
      expect(queryLog.filter((query) => /from "match_demo_imports"/i.test(query) && query.includes('"payload"'))).toHaveLength(0);

      const teamDetail = await checkDetailProjection(() => getTournamentTeamDetail({ seasonId: ids.season, teamId: ids.entryA }, observedDatabase));
      expect(teamDetail.performance).not.toBeNull();

      // A second event proves the all-time profile merges independently
      // confirmed imports while map filtering leaves series facts intact.
      await database.update(schema.matchRosters).set({ status: "confirmed", confirmedAt: now, confirmedBy: "integration-test" })
        .where(eq(schema.matchRosters.matchId, ids.match));
      await client.query("BEGIN");
      await client.query("SET CONSTRAINTS ALL DEFERRED");
      await database.insert(schema.seasons).values({
        id: ids.careerSeason,
        slug: ids.careerSeason,
        name: "DAK career second event",
        kind: "custom",
        status: "finished",
      });
      await database.insert(schema.competitionEntries).values([
        {
          id: ids.careerEntryA,
          competitionId: ids.careerSeason,
          source: "event_native",
          name: "Career A",
          representativeUserId: userIds[0]!,
          registrationStatus: "approved",
          currentRosterRevisionId: ids.careerRevisionA,
          approvedRosterRevisionId: ids.careerRevisionA,
        },
        {
          id: ids.careerEntryB,
          competitionId: ids.careerSeason,
          source: "event_native",
          name: "Career B",
          representativeUserId: userIds[5]!,
          registrationStatus: "approved",
          currentRosterRevisionId: ids.careerRevisionB,
          approvedRosterRevisionId: ids.careerRevisionB,
        },
      ]);
      await database.insert(schema.competitionEntryRepresentativeChanges).values([
        { entryId: ids.careerEntryA, fromUserId: null, toUserId: userIds[0]!, changedByActorId: "integration-test" },
        { entryId: ids.careerEntryB, fromUserId: null, toUserId: userIds[5]!, changedByActorId: "integration-test" },
      ]);
      await database.insert(schema.competitionEntryRosterRevisions).values([
        { id: ids.careerRevisionA, entryId: ids.careerEntryA, revisionNumber: 1, status: "approved", createdBy: userIds[0]!, approvedAt: now },
        { id: ids.careerRevisionB, entryId: ids.careerEntryB, revisionNumber: 1, status: "approved", createdBy: userIds[5]!, approvedAt: now },
      ]);
      await database.insert(schema.competitionEntryParticipants).values(userIds.map((userId, index) => ({
        id: careerParticipantIds[index]!,
        entryId: index < 5 ? ids.careerEntryA : ids.careerEntryB,
        userId,
        status: "confirmed" as const,
        invitedByUserId: index < 5 ? userIds[0]! : userIds[5]!,
        confirmedAt: now,
      })));
      await database.insert(schema.competitionEntryRosterMembers).values(userIds.map((userId, index) => ({
        id: careerRosterMemberIds[index]!,
        revisionId: index < 5 ? ids.careerRevisionA : ids.careerRevisionB,
        participantId: careerParticipantIds[index]!,
        userId,
        isPrimaryStarter: true,
      })));
      await database.insert(schema.eventRosters).values([
        { id: ids.careerEventRosterA, entryId: ids.careerEntryA, sourceRosterRevisionId: ids.careerRevisionA, status: "confirmed", confirmedAt: now, confirmedBy: userIds[0]! },
        { id: ids.careerEventRosterB, entryId: ids.careerEntryB, sourceRosterRevisionId: ids.careerRevisionB, status: "confirmed", confirmedAt: now, confirmedBy: userIds[5]! },
      ]);
      await database.insert(schema.eventRosterMembers).values(userIds.map((userId, index) => ({
        id: careerEventMemberIds[index]!,
        eventRosterId: index < 5 ? ids.careerEventRosterA : ids.careerEventRosterB,
        userId,
        participantId: careerParticipantIds[index]!,
        isPrimaryStarter: true,
      })));
      await database.insert(schema.matches).values({
        id: ids.careerMatch,
        seasonId: ids.careerSeason,
        entryAId: ids.careerEntryA,
        entryBId: ids.careerEntryB,
        stage: "career-stage",
        format: "bo1",
        scoreA: 1,
        scoreB: 0,
        status: "finished",
        completedAt: now,
        mvpWinnerUserId: userIds[0]!,
      });
      await database.insert(schema.matchMaps).values({
        id: ids.careerMap,
        matchId: ids.careerMatch,
        mapOrder: 1,
        mapName: "de_nuke",
        scoreA: 13,
        scoreB: 9,
        completedAt: now,
      });
      await database.insert(schema.matchRosters).values([
        { id: ids.careerRosterA, matchId: ids.careerMatch, entryId: ids.careerEntryA, source: "admin_select", status: "submitted" },
        { id: ids.careerRosterB, matchId: ids.careerMatch, entryId: ids.careerEntryB, source: "admin_select", status: "submitted" },
      ]);
      await database.insert(schema.matchRosterPlayers).values(userIds.map((userId, index) => ({
        rosterId: index < 5 ? ids.careerRosterA : ids.careerRosterB,
        eventRosterMemberId: careerEventMemberIds[index]!,
        isStarter: true,
      })));
      const careerSeasonScope = [ids.season, ids.careerSeason];
      await database.update(schema.dakPairings).set({ seasonIds: careerSeasonScope }).where(eq(schema.dakPairings.id, ids.pairing));
      await client.query("COMMIT");
      const secondEventEvidence: RivalHubEvidenceSubmission = {
        ...evidence,
        source: { ...evidence.source, mapName: "de_nuke", demoSha256: "f".repeat(64) },
        target: {
          ...evidence.target,
          seasonId: ids.careerSeason,
          stageKey: "career-stage",
          matchId: ids.careerMatch,
          matchMapId: ids.careerMap,
          entryAId: ids.careerEntryA,
          entryBId: ids.careerEntryB,
          expectedMapName: "de_nuke",
        },
        participants: evidence.participants.map((participant, index) => ({
          ...participant,
          resolution: {
            status: "matched" as const,
            userId: userIds[index]!,
            eventRosterMemberId: careerEventMemberIds[index]!,
            entryId: index < 5 ? ids.careerEntryA : ids.careerEntryB,
          },
        })),
      };
      secondEventEvidence.target.evidenceRevision = buildEvidenceRevision({
        seasonId: ids.careerSeason,
        stageKey: "career-stage",
        stageRunId: null,
        matchId: ids.careerMatch,
        matchMapId: ids.careerMap,
        mapOrder: 1,
        mapName: "de_nuke",
        mapScoreA: 13,
        mapScoreB: 9,
        mapCompletedAt: now.toISOString(),
        matchStatus: "finished",
        entryAId: ids.careerEntryA,
        entryBId: ids.careerEntryB,
        roster: userIds.map((userId, index) => ({
          entryId: index < 5 ? ids.careerEntryA : ids.careerEntryB,
          eventRosterMemberId: careerEventMemberIds[index]!,
          userId,
          steam64: `765611980000000${String(index + 1).padStart(2, "0")}`,
          isStarter: true,
        })),
      });
      const secondEventImport = await submitRivalHubEvidence({
        input: secondEventEvidence,
        pairingId: ids.pairing,
        pairingScope: { seasonIds: careerSeasonScope },
        idempotencyKey: "dak-career-second-event-1",
      });
      expect(secondEventImport).toMatchObject({ status: "synced", issues: [] });

      // The platform corpus is one batch, preserving canonical users across events.
      const platformScope = { seasonIds: [ids.season, ids.careerSeason] };
      queryLog.length = 0;
      const baselineStarted = performance.now();
      const eventViews = [];
      for (const seasonId of platformScope.seasonIds) eventViews.push(await getTournamentStats({ seasonId }, observedDatabase));
      const baselineMs = performance.now() - baselineStarted;
      const baselineQueries = queryLog.length;
      queryLog.length = 0;
      const platformStarted = performance.now();
      const platformStats = await getTournamentStats(platformScope, observedDatabase);
      const platformMs = performance.now() - platformStarted;
      const platformQueries = queryLog.length;
      const platformQueryLog = [...queryLog];
      expect(platformStats.coverage.detailedMaps).toBe(2);
      expect(platformStats.performance.players).toHaveLength(10);
      expect(platformStats.leaderboard).toHaveLength(10);
      expect(platformStats.leaderboard.every((row) => row.maps === 2)).toBe(true);
      expect(platformStats.analytics.teams).toHaveLength(4); // Same names do not merge event-native entries.
      for (const tab of Object.keys(STATS_TABS) as Array<keyof typeof STATS_TABS>) {
        const query = parseStatsQuery({ tab }, []);
        const scoped = await getTournamentStats({ ...platformScope, view: tab }, observedDatabase);
        expect(publicStatsView(scoped, query)).toEqual(publicStatsView(platformStats, query));
      }

      expect(platformStats.options.teams).toEqual([]);
      expect(platformStats.leaderboard.find((row) => row.userId === userIds[0])?.teamIds?.sort()).toEqual([ids.entryA, ids.careerEntryA].sort());
      queryLog.length = 0;
      const perEventPopulations = [];
      for (const seasonId of platformScope.seasonIds) perEventPopulations.push(await getTournamentPerformancePlayers({ seasonId }, observedDatabase));
      const perEventQueries = queryLog.length;
      queryLog.length = 0;
      const benchmarkPopulations = await getTournamentPerformancePopulations(platformScope.seasonIds, observedDatabase);
      const batchQueries = queryLog.length;
      expect(batchQueries).toBeLessThan(perEventQueries);
      expect(compilePlayerAttributeBenchmark(benchmarkPopulations.flat())).toEqual(compilePlayerAttributeBenchmark(perEventPopulations.flat()));
      console.log(JSON.stringify({ scenario: "benchmark-two-event-batch", events: 2, perEventQueries, batchQueries,
        observations: benchmarkPopulations.flat().length, boundary: "isolated PostgreSQL; not remote cache or production" }));
      expect(benchmarkPopulations).toHaveLength(2);
      expect(benchmarkPopulations.flat()).toHaveLength(eventViews.flatMap(view => view.performance.players).length);
      expect(compilePlayerAttributeBenchmark(benchmarkPopulations.flat())).toEqual(compilePlayerAttributeBenchmark(eventViews.flatMap(view => view.performance.players)));
      const publicEventStats = await getTournamentStats({ seasonId: ids.season, publicOnly: true }, database);
      expect(publicEventStats.leaderboard.find((row) => row.userId === userIds[0])?.teamIds).toEqual([ids.entryA]);
      expect(platformQueryLog.some((query) => /from "match_demo_imports"/i.test(query) && query.includes('"payload"'))).toBe(false);
      expect(platformQueries).toBeLessThan(baselineQueries);
      console.info(JSON.stringify({ scenario: "platform-two-event-batch", baselineQueries, platformQueries,
        baselineMs, platformMs, baselineDtoBytes: Buffer.byteLength(JSON.stringify(eventViews)), platformDtoBytes: Buffer.byteLength(JSON.stringify(platformStats)),
        maps: 2, users: 10, cache: "uncached PostgreSQL; no production latency claim" }));
      expect(platformStats.records).toHaveLength(11);
      expect(platformStats.records?.find(row => row.kind === "fourKillsTotal")?.value).toBe(2);
      expect(platformStats.records?.find(row => row.kind === "acesTotal")?.value).toBe(2);
      const actualEvents = await getTournamentRecordEvents(platformScope, {}, observedDatabase);
      expect(actualEvents.rows.length).toBeLessThanOrEqual(25);
      expect(actualEvents.total).toBeGreaterThan(0);
      const fourKills = await getTournamentRecordEvents(platformScope, { eventType: "fourKill" }, observedDatabase);
      expect(fourKills.total).toBe(platformStats.eventCounts?.fourKill);
      expect(fourKills.rows.every(row => row.kind === "fourKill" && row.teamHref.includes("/teams/") && row.opponentHref.includes("/teams/"))).toBe(true);
      if (actualEvents.pages > 1) {
        const nextPage = await getTournamentRecordEvents(platformScope, { eventPage: 2 }, observedDatabase);
        const keys = new Set(actualEvents.rows.map(row => `${row.mapId}:${row.id}`));
        expect(nextPage.rows.every(row => !keys.has(`${row.mapId}:${row.id}`))).toBe(true);
      }
      await expect(getTournamentRecordEvents(platformScope, { eventPage: actualEvents.pages + 1 }, observedDatabase)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
      expect(queryLog.some(query => /from "match_demo_imports"/i.test(query) && query.includes('"payload"'))).toBe(false);
      expect(platformStats.records?.filter((row) => row.value !== null).length).toBeGreaterThanOrEqual(4);
      expect(platformStats.records?.flatMap((row) => row.occurrences).every((row) => row.entityHref.startsWith("/players/") || row.entityHref.includes("/teams/"))).toBe(true);
      const platformLabels = { teams: Object.fromEntries(platformStats.analytics.teams.map((row) => [row.team.entityKey, row.team.displayName])),
        players: Object.fromEntries(platformStats.performance.players.map((row) => [row.player.entityKey, row.player.displayName])) };
      const careerBindings = new Map(secondEventEvidence.participants.map((participant, index) => [participant.steamId64,
        { userId: userIds[index]!, entryId: index < 5 ? ids.careerEntryA : ids.careerEntryB }]));
      const careerFacts = adaptStatsEvidence(secondEventEvidence, careerBindings);
      // SQL/map ordering may change the last binary digit of floating-point sums.
      const stableNumbers = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "number" ? Number(item.toPrecision(12)) : item));
      expect(stableNumbers(platformStats.performance)).toEqual(stableNumbers(buildTournamentPerformanceAnalytics([expectedFacts.performance, careerFacts.performance], { labels: platformLabels })));
      expect(platformStats.analytics).toEqual(buildTournamentAnalytics([expectedFacts.tournament, careerFacts.tournament], { labels: platformLabels }));
      const linkedTeamId = randomUUID();
      await database.transaction(async (tx) => {
        await tx.insert(schema.teams).values({ id: linkedTeamId, slug: linkedTeamId, name: "Explicit cross-event team", creatorUserId: userIds[0]!, captainUserId: userIds[0]! });
        await tx.insert(schema.teamNameChanges).values({ teamId: linkedTeamId, newName: "Explicit cross-event team", changedByActorId: "integration-test" });
        await tx.insert(schema.teamCaptainChanges).values({ teamId: linkedTeamId, toUserId: userIds[0]!, changedByActorId: "integration-test" });
        await tx.insert(schema.teamMemberships).values({ teamId: linkedTeamId, userId: userIds[0]!, status: "active", invitedByUserId: userIds[0]! });
      });
      try {
        await database.update(schema.competitionEntries).set({ source: "linked_team", teamId: linkedTeamId }).where(inArray(schema.competitionEntries.id, [ids.entryA, ids.careerEntryA]));
        const longDetail = await checkDetailProjection(() => getLongTeamCareerDetail(linkedTeamId, observedDatabase));
        expect(longDetail.maps.map(row => row.mapName)).toEqual(["de_ancient", "de_nuke"]);
        const directory = await getTeamDirectory(normalizeTeamDirectoryQuery({ q: "Explicit cross-event team" }));
        expect(directory.rows.map(row => row.id)).toContain(linkedTeamId);
        expect(directory.total).toBe(directory.rows.length);
        expect(directory.rows.find(row => row.id === linkedTeamId)?.memberCount).toBe(1);
        const missingDirectory = await getTeamDirectory(normalizeTeamDirectoryQuery({ q: randomUUID() }));
        expect(missingDirectory).toMatchObject({ rows: [], total: 0, hasAnyTeams: true });
        expect(await getPublicTeamProfileLink(linkedTeamId)).toEqual({ id: linkedTeamId, slug: linkedTeamId, name: "Explicit cross-event team" });
        expect(await getPublicTeamProfileLink(randomUUID())).toBeNull();
        const basics = await getPublicTeamProfileBasics(linkedTeamId);
        expect(basics?.currentMembers.map(row => row.userId)).toContain(userIds[0]);
        expect(await getPublicTeamProfileCore(linkedTeamId, undefined, longDetail.official.matches, basics!))
          .toEqual(await getPublicTeamProfileCore(linkedTeamId, undefined, longDetail.official.matches));

        const linkedStats = await getTournamentStats(platformScope, observedDatabase);
        expect(linkedStats.analytics.teams).toHaveLength(3);
        expect(linkedStats.analytics.teams.find((row) => row.team.entityKey === linkedTeamId)?.mapCount).toBe(2);
        expect(linkedStats.teamLinks?.[linkedTeamId]).toBe(`/teams/${linkedTeamId}`);
        const linkedEvent = await getTournamentStats({ seasonId: ids.season, publicOnly: true }, observedDatabase);
        expect(linkedEvent.teamLinks?.[ids.entryA]).toBe(eventViews[0]!.teamLinks?.[ids.entryA]);
        expect(linkedStats.performance.players).toHaveLength(10);
      } finally {
        await database.update(schema.competitionEntries).set({ source: "event_native", teamId: null }).where(inArray(schema.competitionEntries.id, [ids.entryA, ids.careerEntryA]));
        await database.transaction(async (tx) => {
          // Isolated fixture teardown follows the existing append-only cleanup below.
          await tx.execute(sql`SET LOCAL session_replication_role = replica`);
          await tx.delete(schema.teamMemberships).where(eq(schema.teamMemberships.teamId, linkedTeamId));
          await tx.delete(schema.teamCaptainChanges).where(eq(schema.teamCaptainChanges.teamId, linkedTeamId));
          await tx.delete(schema.teamNameChanges).where(eq(schema.teamNameChanges.teamId, linkedTeamId));
          await tx.delete(schema.teams).where(eq(schema.teams.id, linkedTeamId));
        });
      }
      // Public membership is re-read: archived stays included, draft never leaks.
      await database.update(schema.seasons).set({ status: "archived" }).where(eq(schema.seasons.id, ids.careerSeason));
      expect((await getTournamentStats(platformScope, observedDatabase)).coverage.detailedMaps).toBe(2);
      await database.update(schema.seasons).set({ status: "draft" }).where(eq(schema.seasons.id, ids.careerSeason));
      expect((await getTournamentStats(platformScope, observedDatabase)).coverage.detailedMaps).toBe(1);
      await expect(getTournamentStats({ seasonId: ids.careerSeason, publicOnly: true }, observedDatabase)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
      expect(await getTournamentPerformancePopulations([ids.careerSeason], observedDatabase)).toEqual([]);
      expect((await loadLineupCareers(userIds, randomUUID(), new Date(now.getTime() + 1), observedDatabase)).every(row => row.maps === 1)).toBe(true);
      await database.update(schema.seasons).set({ status: "playing" }).where(eq(schema.seasons.id, ids.careerSeason));

      const coverage = await database.transaction((tx) => inspectStatisticsProjectionCoverage(tx, { batchSize: 1 }),
        { isolationLevel: "repeatable read", accessMode: "read only" });
      expect(coverage).toMatchObject({ complete: true, ready: true, missing: 0 });
      const truncated = await database.transaction((tx) => inspectStatisticsProjectionCoverage(tx, { batchSize: 1, scanLimit: 1 }),
        { isolationLevel: "repeatable read", accessMode: "read only" });
      expect(truncated).toMatchObject({ complete: false, ready: false, scanned: 1, missing: 0 });

      // Old app writes during cutover are repaired independently of page reads.
      // A stale first candidate must not starve a later valid map with limit=1.
      const orderedCandidates = [
        { mapId: ids.map, importId, revision: evidence.target.evidenceRevision },
        { mapId: ids.careerMap, importId: secondEventImport.importId!, revision: secondEventEvidence.target.evidenceRevision },
      ].sort((a, b) => a.mapId.localeCompare(b.mapId));
      await database.delete(schema.matchDemoStatProjections).where(and(
        inArray(schema.matchDemoStatProjections.importId, orderedCandidates.map((row) => row.importId)),
        eq(schema.matchDemoStatProjections.projectionVersion, STATISTICS_PROJECTION_VERSION),
      ));
      await database.update(schema.matchDemoImports).set({ evidenceRevision: "stale-revision" }).where(eq(schema.matchDemoImports.id, orderedCandidates[0]!.importId));
      await database.delete(schema.statisticsProjectionRepairCursors);
      expect(await reconcileMissingStatisticsProjections(database, { limit: 1, scanLimit: 1 })).toMatchObject({ candidates: 1, scanned: 1, rebuilt: 0, skipped: 1, invalid: 0, failed: 0 });
      // A new invocation resumes after the stale prefix, even with a one-ID budget.
      expect(await reconcileMissingStatisticsProjections(database, { limit: 1, scanLimit: 1 })).toMatchObject({ candidates: 1, scanned: 1, rebuilt: 1, invalid: 0, failed: 0 });
      await database.update(schema.matchDemoImports).set({ evidenceRevision: orderedCandidates[0]!.revision }).where(eq(schema.matchDemoImports.id, orderedCandidates[0]!.importId));
      expect(await reconcileMissingStatisticsProjections(database, { limit: 1, scanLimit: 1 })).toMatchObject({ wrapped: true, scanned: 0 });
      expect(await reconcileMissingStatisticsProjections(database, { limit: 1, scanLimit: 1 })).toMatchObject({ rebuilt: 1, invalid: 0, failed: 0 });
      // Simulate a worker lost after claiming a range: the persisted cursor is
      // past still-missing work. Wrap must revisit it, including concurrent runs.
      await database.delete(schema.matchDemoStatProjections).where(inArray(schema.matchDemoStatProjections.importId, orderedCandidates.map((row) => row.importId)));
      await database.update(schema.statisticsProjectionRepairCursors).set({ afterMapId: orderedCandidates[1]!.mapId });
      expect(await reconcileMissingStatisticsProjections(database, { scanLimit: 1 })).toMatchObject({ wrapped: true, scanned: 0 });
      const concurrentDatabase = drizzle(pool, { schema });
      const concurrentRepair = await Promise.all([
        reconcileMissingStatisticsProjections(concurrentDatabase, { limit: 1, scanLimit: 1 }),
        reconcileMissingStatisticsProjections(concurrentDatabase, { limit: 1, scanLimit: 1 }),
      ]);
      expect(concurrentRepair.map((report) => report.rebuilt)).toEqual([1, 1]);
      expect(new Set(concurrentRepair.map((report) => report.afterMapId)).size).toBe(2);
      // A persistent PostgreSQL failure in the first map must not consume the
      // next map's cursor. Inject the failure after real validation, at INSERT.
      const failRepair = `fail_repair_${randomUUID().replaceAll("-", "")}`;
      await database.delete(schema.matchDemoStatProjections).where(inArray(schema.matchDemoStatProjections.importId, orderedCandidates.map((row) => row.importId)));
      await database.update(schema.statisticsProjectionRepairCursors).set({ afterMapId: null });
      await client.query(`CREATE FUNCTION ${failRepair}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.import_id = '${orderedCandidates[0]!.importId}'::uuid THEN
          RAISE EXCEPTION 'repair failure fixture'; END IF; RETURN NEW; END $$`);
      try {
        await client.query(`CREATE TRIGGER ${failRepair} BEFORE INSERT ON match_demo_stat_projections FOR EACH ROW EXECUTE FUNCTION ${failRepair}()`);
        queryLog.length = 0;
        const failedScan = await reconcileMissingStatisticsProjections(observedDatabase, { limit: 1, scanLimit: 50 });
        expect(failedScan).toMatchObject({ candidates: 1, scanned: 1, failed: 1, rebuilt: 0, budgetExhausted: true });
        console.info(JSON.stringify({ scenario: "bounded-failed-prefix", queries: queryLog.length, scanned: failedScan.scanned, durationMs: failedScan.durationMs }));
        expect(await reconcileMissingStatisticsProjections(database, { limit: 1, scanLimit: 50 })).toMatchObject({ scanned: 1, rebuilt: 1, failed: 0 });
      } finally {
        await client.query(`DROP TRIGGER IF EXISTS ${failRepair} ON match_demo_stat_projections`);
        await client.query(`DROP FUNCTION ${failRepair}()`);
      }
      expect(await reconcileMissingStatisticsProjections(database)).toMatchObject({ wrapped: true, scanned: 0 });
      expect(await reconcileMissingStatisticsProjections(database, { limit: 1 })).toMatchObject({ rebuilt: 1 });
      queryLog.length = 0;
      queryBindings.length = 0;
      expect(await reconcileMissingStatisticsProjections(observedDatabase)).toMatchObject({ candidates: 0, scanned: 0, rebuilt: 0 });
      expect(queryLog.some((query) => /"payload"|"facts"/.test(query))).toBe(false);


      queryLog.length = 0;
      queryBindings.length = 0;
      const allTimeCareer = await checkDetailProjection(() => getPlayerCareerDetail({ playerId: userIds[0]! }, observedDatabase));
      expect(allTimeCareer.maps.map(row => row.mapName)).toEqual(["de_ancient", "de_nuke"]);
      expect(stableNumbers(allTimeCareer.performance)).toEqual(stableNumbers(platformStats.performance.players.find(row => row.player.entityKey === userIds[0])));
      expect(stableNumbers(allTimeCareer.maps.map(row => row.performance))).toEqual(stableNumbers([
        buildTournamentPerformanceAnalytics([expectedFacts.performance], { labels: platformLabels }).players.find(row => row.player.entityKey === userIds[0]),
        buildTournamentPerformanceAnalytics([careerFacts.performance], { labels: platformLabels }).players.find(row => row.player.entityKey === userIds[0]),
      ]));
      expect(allTimeCareer.summary).toMatchObject({ matches: 2, wins: 2, losses: 0, mvp: 1, maps: 2 });
      expect(allTimeCareer.scoreboard[0]).toMatchObject({ maps: 2 });
      expect(allTimeCareer.scoreboardMaps.map((row) => row.mapName)).toEqual(["de_ancient", "de_nuke"]);
      expect(allTimeCareer.events).toHaveLength(2);
      expect(queryLog.some((query) => /from "match_demo_imports"/i.test(query) && query.includes('"payload"'))).toBe(false);
      const evidenceProjectionQuery = queryLog.find((query) => /from "match_demo_stat_projections"/i.test(query) && query.includes('"facts"'));
      expect(evidenceProjectionQuery).toBeDefined();
      const selectedImportIds = queryBindings[queryLog.indexOf(evidenceProjectionQuery!)];
      expect(selectedImportIds).toHaveLength(3);
      expect(selectedImportIds).toContain(STATISTICS_PROJECTION_VERSION);
      expect(selectedImportIds).not.toContain(ids.legacyImport);
      expect(selectedImportIds).not.toContain(conflictBeforePromotionId);


      // Roster scouting must match individual careers across transfers without N+1 projection reads.
      queryLog.length = 0;
      const rosterCareers = await getPlayerCareerPerformances(userIds, observedDatabase);
      const rosterProjectionReads = queryLog.filter((query) => /from "match_demo_stat_projections"/i.test(query) && query.includes('"facts"'));
      console.info(JSON.stringify({ scenario: "lineup-career-batch", players: rosterCareers.length, queries: queryLog.length, projectionReads: rosterProjectionReads.length, maps: rosterCareers.map((career) => career.maps), dtoBytes: Buffer.byteLength(JSON.stringify(rosterCareers)), cache: "uncached local PostgreSQL; not provider billing or remote cache evidence" }));
      expect(queryLog.some((query) => /from "match_demo_imports"/i.test(query) && query.includes('"payload"'))).toBe(false);
      for (const career of rosterCareers) {
        const individual = await getPlayerCareerDetail({ playerId: career.playerId }, database);
        expect(stableNumbers(career.performance)).toEqual(stableNumbers(individual.performance));
        expect({ maps: career.maps, rounds: career.rounds }).toEqual({ maps: individual.summary.maps, rounds: individual.summary.rounds });
      }

      // Prematch scouting shares the scoreboard aggregation and historical population.
      queryLog.length = 0;
      const stream = (client as unknown as {connection:{stream:NodeJS.ReadableStream}}).connection.stream;
      let protocolBytes = 0; const countBytes = (chunk:Uint8Array) => { protocolBytes += chunk.byteLength; };
      stream.on("data", countBytes);
      const comparison = await loadLineupCareers(userIds, randomUUID(), new Date(now.getTime() + 1), observedDatabase);
      stream.removeListener("data", countBytes);
      console.info("LINEUP_POPULATION_PROTOCOL_BYTES", protocolBytes);
      expect(comparison).toHaveLength(userIds.length);
      const comparisonQueries = queryLog.length;
      const cutoff = new Date(now.getTime() + 1), excluded = randomUUID();
      const population = await loadLineupPopulation(excluded, cutoff, observedDatabase);
      const ranked = await observedDatabase.transaction(async tx => {
        const selection = await getCurrentStatsSelectionInTx(tx, {before:cutoff,excludeMatchId:excluded});
        const rows = await getStatsLeaderboard({}, selection.currentImportIds, selection.roster, tx, {groupByTeam:false,requireCurrentImports:true,requireRosterMatch:true});
        return partitionRankingPopulation(rows, row => row.avgRating, row => row.rounds).ranked;
      }, {isolationLevel:"repeatable read",accessMode:"read only"});
      const qualified = new Set(ranked.map(row => row.userId));
      expect(population.every(row => row.qualified === qualified.has(row.userId))).toBe(true);
      for (const lineup of [userIds.slice(0, 5), userIds.slice(5)]) {
        const selected = await loadLineupCareers(lineup, excluded, cutoff, observedDatabase);
        expect(selected).toEqual(population.filter(row => new Set<string>(lineup).has(row.userId)));
      }
      expect(queryLog.some(query => query.includes('"facts"') || query.includes('"payload"'))).toBe(false);
      console.info(JSON.stringify({ scenario: "lineup-comparison", queries: comparisonQueries, players: comparison.length, dtoBytes: Buffer.byteLength(JSON.stringify(comparison)), cache: "uncached local PostgreSQL" }));
      const firstCareer = allTimeCareer.scoreboard[0]!;
      expect(comparison.find(row => row.userId === userIds[0])).toMatchObject({ maps: firstCareer.maps, rounds: firstCareer.rounds, rating: firstCareer.avgRating, adr: firstCareer.avgAdr, kpr: firstCareer.kpr, kast: firstCareer.kast, firstKill: firstCareer.fkpr, trade: firstCareer.tradeKpr });
      // A match ending exactly at the cutoff cannot leak into its own preview.
      expect(await loadLineupCareers(userIds, randomUUID(), now, observedDatabase)).toEqual([]);
      const withoutCurrent = await loadLineupCareers(userIds, ids.careerMatch, new Date(now.getTime() + 1), observedDatabase);
      expect(withoutCurrent.every(row => row.maps === 1)).toBe(true);
      expect(await loadLineupCareers([], ids.match, new Date(), observedDatabase)).toEqual([]);

      const eventCareer = await getPlayerCareerDetail({ playerId: userIds[0]!, eventSlug: ids.season }, observedDatabase);
      const tournamentCareer = await checkDetailProjection(() => getTournamentPlayerDetail({ playerId: userIds[0]!, seasonId: ids.season }, observedDatabase));
      expect(eventCareer.scoreboard).toEqual(tournamentCareer.scoreboard);
      expect(eventCareer.performance).toEqual(tournamentCareer.performance);
      expect(eventCareer.summary).toEqual(tournamentCareer.summary);
      expect(eventCareer.summary).toMatchObject({ matches: 1, wins: 1, losses: 0, mvp: 0, maps: 1 });

      const mapCareer = await checkDetailProjection(() => getPlayerCareerDetail({ playerId: userIds[0]!, mapFilter: "de_ancient" }, observedDatabase));
      expect(mapCareer.summary).toMatchObject({ matches: 2, wins: 2, losses: 0, mvp: 1, maps: 1 });
      expect(mapCareer.scoreboard[0]).toMatchObject({ maps: 1 });
      expect(mapCareer.scoreboardMaps.map((row) => row.mapName)).toEqual(["de_ancient"]);

      const emptyPlayer = await getTournamentPlayerDetail({ playerId: randomUUID(), seasonId: ids.season }, database);
      expect(emptyPlayer.performance).toBeNull();
      expect(emptyPlayer.maps).toEqual([]);
      async function expectDetailsUnavailable() {
        const player = await getTournamentPlayerDetail({ playerId: userIds[0]!, seasonId: ids.season }, database);
        expect(player.performance).toBeNull();
        expect(player.coverage.detailedMaps).toBe(0);
        expect((await getTournamentTeamDetail({ seasonId: ids.season, teamId: ids.entryA }, database)).performance).toBeNull();
        expect((await getTournamentMapDetail({ seasonId: ids.season, map: "de_ancient" }, database)).coverage.detailedMaps).toBe(0);
      }
      for (const invalid of [{ completedAt: null }, { scoreA: null, scoreB: null, completedAt: null }, { completedAt: new Date(now.getTime() + 1_000) }]) {
        await database.update(schema.matchMaps).set(invalid).where(eq(schema.matchMaps.id, ids.map));
        try {
          await expectDetailsUnavailable();
        } finally {
          await database.update(schema.matchMaps).set({ completedAt: now, scoreA: 13, scoreB: 9 }).where(eq(schema.matchMaps.id, ids.map));
        }
      }

      // Both target identities remain mandatory after narrowing JSONB fields.
      const [detailProjection] = await database.select().from(schema.matchDemoStatProjections)
        .where(and(eq(schema.matchDemoStatProjections.importId, importId), eq(schema.matchDemoStatProjections.projectionVersion, STATISTICS_PROJECTION_VERSION)));
      for (const section of ["tournament", "performance"] as const) {
        for (const key of ["mapKey", "matchKey"] as const) {
          await database.update(schema.matchDemoStatProjections).set({ facts: {
            ...detailProjection!.facts, performanceTransport: undefined, [section]: { ...detailProjection!.facts[section], [key]: randomUUID() },
          } }).where(eq(schema.matchDemoStatProjections.importId, importId));
          try {
            await expect(getTournamentPlayerDetail({ playerId: userIds[0]!, seasonId: ids.season }, database)).rejects.toThrow("Statistics projection target mismatch");
            await expect(getTournamentTeamDetail({ seasonId: ids.season, teamId: ids.entryA }, database)).rejects.toThrow("Statistics projection target mismatch");
            await expect(getTournamentMapDetail({ seasonId: ids.season, map: "de_ancient" }, database)).rejects.toThrow("Statistics projection target mismatch");
          } finally {
            await database.update(schema.matchDemoStatProjections).set({ facts: detailProjection!.facts }).where(eq(schema.matchDemoStatProjections.importId, importId));
          }
        }
      }
      for (const invalid of [
        { evidenceRevision: "stale-detail-revision" },
        { identityBindings: detailProjection!.identityBindings.map((binding, index) => index === 0 ? { ...binding, userId: randomUUID() } : binding) },
      ]) {
        await database.update(schema.matchDemoStatProjections).set(invalid).where(eq(schema.matchDemoStatProjections.importId, importId));
        try {
          await expectDetailsUnavailable();
        } finally {
          await database.update(schema.matchDemoStatProjections).set({ evidenceRevision: detailProjection!.evidenceRevision, identityBindings: detailProjection!.identityBindings })
            .where(eq(schema.matchDemoStatProjections.importId, importId));
        }
      }

      const revisedCompletedAt = new Date(now.getTime() + 1_000);
      await database.update(schema.matchMaps).set({ completedAt: revisedCompletedAt }).where(eq(schema.matchMaps.id, ids.map));
      expect((await getTournamentStats({ seasonId: ids.season }, database)).coverage.detailedMaps).toBe(0);
      expect(await getVerifiedPlayerStatsBySeason(ids.season, [userIds[0]!])).toEqual(new Map());
      const evidenceRevisionNPlusOne = buildEvidenceRevision({
        seasonId: ids.season,
        stageKey: "fixture-stage",
        stageRunId: null,
        matchId: ids.match,
        matchMapId: ids.map,
        mapOrder: 1,
        mapName: "de_ancient",
        mapScoreA: 13,
        mapScoreB: 9,
        mapCompletedAt: revisedCompletedAt.toISOString(),
        matchStatus: "finished",
        entryAId: ids.entryA,
        entryBId: ids.entryB,
        roster: userIds.map((userId, index) => ({
          entryId: index < 5 ? ids.entryA : ids.entryB,
          eventRosterMemberId: eventMemberIds[index]!,
          userId,
          steam64: `765611980000000${String(index + 1).padStart(2, "0")}`,
          isStarter: true,
        })),
      });
      const evidenceNPlusOne: RivalHubEvidenceSubmission = {
        ...evidence,
        target: { ...evidence.target, evidenceRevision: evidenceRevisionNPlusOne },
      };
      const revised = await submitRivalHubEvidence({
        input: evidenceNPlusOne,
        pairingId: ids.pairing,
        pairingScope: { seasonIds: [ids.season] },
        idempotencyKey: "dak-retry-evidence-revision-2",
      });
      expect(revised.status).toBe("synced");
      expect(revised.importId).not.toBe(importId);
      const revisedImportId = revised.importId;
      if (!revisedImportId) throw new Error("测试未创建 revision N+1 Demo import");

      const importsAfterRevision = await database.select().from(schema.matchDemoImports).where(eq(schema.matchDemoImports.matchMapId, ids.map));
      expect(importsAfterRevision).toHaveLength(4);
      expect(importsAfterRevision.find((row) => row.id === importId)).toMatchObject({ status: "superseded" });
      expect(importsAfterRevision.find((row) => row.id === revisedImportId)).toMatchObject({
        status: "confirmed",
        evidenceRevision: evidenceRevisionNPlusOne,
        supersedesImportId: importId,
        issues: [],
      });
      expect(importsAfterRevision.find((row) => row.id === revisedImportId)?.payload).toEqual(evidenceNPlusOne);
      expect(await database.select().from(schema.matchRoundFacts).where(eq(schema.matchRoundFacts.importId, revisedImportId))).toHaveLength(evidenceNPlusOne.sourceFacts.rounds.length);
      expect(await database.select().from(schema.matchRoundFacts).where(eq(schema.matchRoundFacts.importId, importId))).toHaveLength(factsAfterPromotion.length);
      expect((await database.select().from(schema.matchPlayerStats).where(eq(schema.matchPlayerStats.id, ids.ocrStat)))[0]).toMatchObject({ dakImportId: revisedImportId });

      expect((await getTournamentStats({ seasonId: ids.season }, database)).analytics.totals.mapCount).toBe(1);
      const retryRevision = await submitRivalHubEvidence({
        input: evidenceNPlusOne,
        pairingId: ids.pairing,
        pairingScope: { seasonIds: [ids.season] },
        idempotencyKey: "dak-retry-evidence-revision-2",
      });
      expect(retryRevision).toMatchObject({ status: "synced", importId: revisedImportId, issues: [] });
      expect(await database.select().from(schema.matchDemoImports).where(eq(schema.matchDemoImports.matchMapId, ids.map))).toHaveLength(4);
      expect(await database.select().from(schema.matchRoundFacts).where(eq(schema.matchRoundFacts.importId, revisedImportId))).toHaveLength(evidenceNPlusOne.sourceFacts.rounds.length);
      const revisedAudits = await database.select().from(schema.auditLogs).where(and(
        eq(schema.auditLogs.action, "match.demo.auto_confirm"),
        eq(schema.auditLogs.targetId, revisedImportId),
      ));
      expect(revisedAudits).toHaveLength(1);
      expect((await database.select().from(schema.matchPlayerStats).where(eq(schema.matchPlayerStats.id, ids.ocrStat)))[0]).toMatchObject({ dakImportId: revisedImportId });

      const conflictingEvidence: RivalHubEvidenceSubmission = {
        ...evidenceNPlusOne,
        source: { ...evidenceNPlusOne.source, demoSha256: "b".repeat(64) },
      };
      const conflict = await submitRivalHubEvidence({
        input: conflictingEvidence,
        pairingId: ids.pairing,
        pairingScope: { seasonIds: [ids.season] },
        idempotencyKey: "dak-retry-evidence-conflict-3",
      });
      expect(conflict.status).toBe("needs_attention");
      expect(conflict.issues.some((row) => row.code === "CONTENT_CONFLICT")).toBe(true);
      expect(await database.select().from(schema.matchDemoImports).where(eq(schema.matchDemoImports.matchMapId, ids.map))).toHaveLength(5);

      const primarySteam64 = evidence.participants[0]!.steamId64;
      const alternateSteam64 = "76561198123456789";
      const aliasEvidence = demoEvidenceContract.parseRivalHubDemoEvidenceV1(JSON.parse(
        JSON.stringify(evidenceNPlusOne).replaceAll(primarySteam64, alternateSteam64),
      ) as unknown);
      aliasEvidence.participants[0] = {
        ...aliasEvidence.participants[0]!,
        resolution: { status: "unresolved" },
      };
      const needsIdentity = await submitRivalHubEvidence({
        input: aliasEvidence,
        pairingId: ids.pairing,
        pairingScope: { seasonIds: [ids.season] },
        idempotencyKey: "dak-identity-review-1",
      });
      expect(needsIdentity.status).toBe("needs_attention");
      expect(needsIdentity.issues.some((row) => row.code === "PARTICIPANT_IDENTITY_UNRESOLVED")).toBe(true);
      expect(needsIdentity.importId).not.toBeNull();
      if (!needsIdentity.importId) throw new Error("测试未创建身份待处理 Demo");

      const readReview = () => database.transaction(async (tx) => {
        const [row] = await tx.select().from(schema.matchDemoImports).where(eq(schema.matchDemoImports.id, needsIdentity.importId!));
        if (!row) throw new Error("Missing review import");
        return loadAdminDemoReview(tx, row, await loadCanonicalTarget(tx, aliasEvidence.target), new Map([[ids.entryA, "Alpha"], [ids.entryB, "Beta"]]));
      });
      const initialReview = await readReview();
      expect(initialReview.resolvedCount).toBe(9);
      expect(initialReview.participants).toHaveLength(1);
      expect(initialReview.participants[0]).toMatchObject({ state: "confirmable", observedSteam64: alternateSteam64 });
      expect(initialReview.participants[0]!.candidates.every((candidate) => candidate.entryId === ids.entryA)).toBe(true);
      const wrongIdentity = await database.transaction((tx) => recordGameplaySteamIdentityInTx(tx, {
        userId: userIds[5]!, steam64: alternateSteam64, actorId: userIds[0]!,
        provenance: "admin_confirmed_alternate", sourceImportId: needsIdentity.importId!, reason: "测试错误关联的审核入口",
      }));
      const conflictReview = await readReview();
      expect(conflictReview.participants[0]).toMatchObject({ state: "conflict-retirable", retirableIdentityId: wrongIdentity.id,
        currentPlayer: { userId: userIds[5]! } });
      await database.transaction((tx) => retireSeasonGameplaySteamIdentityInTx(tx, {
        identityId: wrongIdentity.id, seasonId: ids.season, actorId: userIds[0]!, reason: "核对后撤销错误关联",
      }));
      expect((await readReview()).participants[0]?.state).toBe("confirmable");

      const aliasesBeforeWrongParticipant = await database.select().from(schema.userGameplaySteamIds)
        .where(eq(schema.userGameplaySteamIds.userId, userIds[0]!));
      await expect(database.transaction((tx) => confirmStoredDemoParticipantIdentityInTx(tx, {
        importId: needsIdentity.importId!,
        observedSteam64: alternateSteam64,
        eventRosterMemberId: eventMemberIds[5]!,
        actorId: userIds[0]!,
      }))).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
      expect(await database.select().from(schema.userGameplaySteamIds)
        .where(eq(schema.userGameplaySteamIds.userId, userIds[0]!))).toEqual(aliasesBeforeWrongParticipant);

      // Protect the original target-read cause, atomic identity + promotion and
      // immutable facts. SQL errors abort PG; a coding error does not. Neither
      // may be persisted as a business issue. Existing happy paths cannot prove it.
      const recheckSnapshot = async () => ({
        imports: await database.select().from(schema.matchDemoImports).where(eq(schema.matchDemoImports.matchMapId, ids.map)).orderBy(schema.matchDemoImports.id),
        rounds: await database.select().from(schema.matchRoundFacts).innerJoin(schema.matchDemoImports, eq(schema.matchRoundFacts.importId, schema.matchDemoImports.id)).where(eq(schema.matchDemoImports.matchMapId, ids.map)).orderBy(schema.matchRoundFacts.id),
        stats: await database.select().from(schema.matchPlayerStats).where(eq(schema.matchPlayerStats.mapId, ids.map)).orderBy(schema.matchPlayerStats.id),
        projections: await database.select().from(schema.matchDemoStatProjections).innerJoin(schema.matchDemoImports, eq(schema.matchDemoStatProjections.importId, schema.matchDemoImports.id)).where(eq(schema.matchDemoImports.matchMapId, ids.map)).orderBy(schema.matchDemoStatProjections.importId),
        identities: await database.select().from(schema.userGameplaySteamIds).where(inArray(schema.userGameplaySteamIds.userId, userIds)).orderBy(schema.userGameplaySteamIds.id),
        audits: await database.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.seasonId, ids.season), ne(schema.auditLogs.targetId, ids.mixedImport))).orderBy(schema.auditLogs.id),
        matches: await database.select().from(schema.matches).where(eq(schema.matches.id, ids.match)),
        maps: await database.select().from(schema.matchMaps).where(eq(schema.matchMaps.id, ids.map)),
      });
      const beforeFault = await recheckSnapshot();
      // A pure-parser defect must roll back instead of persisting an invalid
      // payload issue or turning identity review into an expected rejection.
      for (const operation of ["recheck", "identity"] as const) {
        const parserCause = new TypeError("synthetic evidence parser failure token=private");
        const parser = vi.spyOn(demoEvidenceContract, "parseRivalHubDemoEvidenceV1")
          .mockImplementation(() => { throw parserCause; });
        try {
          await expect(database.transaction(tx => operation === "recheck"
            ? revalidateStoredDemoImportInTx(tx, { importId: needsIdentity.importId!, actorId: userIds[0]! })
            : confirmStoredDemoParticipantIdentityInTx(tx, {
              importId: needsIdentity.importId!, observedSteam64: alternateSteam64,
              eventRosterMemberId: eventMemberIds[0]!, actorId: userIds[0]!,
            }))).rejects.toBe(parserCause);
        } finally { parser.mockRestore(); }
        expect(sha256Json(await recheckSnapshot()), operation).toBe(sha256Json(beforeFault));
      }
      for (const fault of ["coding", "sql", "timeout", "identity-after-write"] as const) {
        const originalQuery = client.query;
        let matchReads = 0;
        let injected = false;
        const codingCause = new TypeError("synthetic target reader failure token=private");
        client.query = ((...args: unknown[]) => {
          const query = args[0];
          const text = typeof query === "string" ? query : (query as { text?: string })?.text;
          if (text?.includes('from "matches"') && ++matchReads === (fault === "identity-after-write" ? 3 : 1)) {
            injected = true;
            if (fault === "coding") return Promise.reject(codingCause);
            // Execute real PostgreSQL failures through the actual driver. No
            // production SQL or error object is replaced with a mock SQLSTATE.
            return Reflect.apply(originalQuery, client, [fault === "timeout" ? "SELECT pg_sleep(0.1)" : "SELECT 1 / 0"]);
          }
          return Reflect.apply(originalQuery, client, args);
        }) as typeof client.query;
        let caught: unknown;
        try {
          await database.transaction(async (tx) => {
            if (fault === "timeout") await tx.execute(sql`SET LOCAL statement_timeout = '10ms'`);
            return fault === "identity-after-write"
              ? confirmStoredDemoParticipantIdentityInTx(tx, { importId: needsIdentity.importId!, observedSteam64: alternateSteam64, eventRosterMemberId: eventMemberIds[0]!, actorId: userIds[0]! })
              : revalidateStoredDemoImportInTx(tx, { importId: needsIdentity.importId!, actorId: userIds[0]! });
          });
        } catch (error) { caught = error; }
        finally { client.query = originalQuery; }
        expect(injected, fault).toBe(true);
        const afterFault = await recheckSnapshot();
        expect(afterFault.imports.map(row => row.issues.map(issue => issue.code)), fault).toEqual(beforeFault.imports.map(row => row.issues.map(issue => issue.code)));
        expect(caught, fault).toBeDefined();
        if (fault === "coding") expect((caught as Error).cause).toBe(codingCause);
        else expect(extractPgError(caught)?.code, fault).toBe(fault === "timeout" ? "57014" : "22012");
        expect(sha256Json(afterFault), fault).toBe(sha256Json(beforeFault));
        const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
        try {
          const response = actionError("recheckStoredDemoImport", caught, "recheck");
          expect(response).toMatchObject({ success: false, error: { code: ErrorCode.INTERNAL_ERROR, requestId: expect.any(String) } });
          const event = JSON.parse(String(write.mock.calls[0][0]));
          expect(event.requestId).toBe(!response.success && response.error.requestId);
          if (fault !== "coding") expect(event.exception.code).toBe(fault === "timeout" ? "57014" : "22012");
          expect(JSON.stringify(event)).not.toMatch(/SELECT|pg_sleep|token=private/);
        } finally { write.mockRestore(); }
        expect((await readReview()).participants[0]?.state).toBe("confirmable");
      }

      // Same invocation: a newer, valid map confirms before the existing
      // pending map fails. Seed stored evidence, not a mocked owner result.
      await database.insert(schema.matches).values({ id: ids.mixedMatch, seasonId: ids.season,
        entryAId: ids.entryA, entryBId: ids.entryB, stage: "fixture-stage", format: "bo1",
        scoreA: 1, scoreB: 0, status: "finished", completedAt: now });
      await database.insert(schema.matchRosters).values([
        { id: ids.mixedRosterA, matchId: ids.mixedMatch, entryId: ids.entryA, source: "admin_select", status: "submitted" },
        { id: ids.mixedRosterB, matchId: ids.mixedMatch, entryId: ids.entryB, source: "admin_select", status: "submitted" },
      ]);
      await database.insert(schema.matchRosterPlayers).values(eventMemberIds.map((eventRosterMemberId, index) => ({
        rosterId: index < 5 ? ids.mixedRosterA : ids.mixedRosterB, eventRosterMemberId, isStarter: true,
      })));
      await database.insert(schema.matchMaps).values({ id: ids.mixedMap, matchId: ids.mixedMatch,
        mapOrder: 1, mapName: "de_ancient", scoreA: 13, scoreB: 9, completedAt: now });
      const mixedTarget = await database.transaction(tx => loadCanonicalTarget(tx, {
        seasonId: ids.season, matchId: ids.mixedMatch, matchMapId: ids.mixedMap,
      }));
      const mixedEvidence = structuredClone(evidenceNPlusOne);
      mixedEvidence.target = { ...mixedEvidence.target, matchId: ids.mixedMatch, matchMapId: ids.mixedMap,
        evidenceRevision: buildEvidenceRevisionForTarget(mixedTarget) };
      await database.insert(schema.matchDemoImports).values({
        id: ids.mixedImport, seasonId: ids.season, matchId: ids.mixedMatch, matchMapId: ids.mixedMap,
        stageKey: mixedEvidence.target.stageKey, stageRunId: mixedEvidence.target.stageRunId ?? null,
        demoSha256: mixedEvidence.source.demoSha256, payloadSha256: sha256Json(mixedEvidence),
        contractVersion: mixedEvidence.contract.contractVersion, semanticProfile: mixedEvidence.contract.semanticProfile,
        analysisVersion: mixedEvidence.contract.analysisVersion, evidenceRevision: mixedEvidence.target.evidenceRevision,
        status: "needs_attention", payload: mixedEvidence, submittedByPairingId: ids.pairing,
        idempotencyKey: "dak-mixed-batch-success", issues: [], createdAt: new Date(Date.now() + 1_000),
      });
      const mixedSuccessSnapshot = async () => ({
        imports: await database.select().from(schema.matchDemoImports).where(eq(schema.matchDemoImports.id, ids.mixedImport)),
        rounds: await database.select().from(schema.matchRoundFacts).where(eq(schema.matchRoundFacts.importId, ids.mixedImport)).orderBy(schema.matchRoundFacts.roundSeq),
        stats: await database.select().from(schema.matchPlayerStats).where(eq(schema.matchPlayerStats.mapId, ids.mixedMap)).orderBy(schema.matchPlayerStats.id),
        projections: await database.select().from(schema.matchDemoStatProjections).where(eq(schema.matchDemoStatProjections.importId, ids.mixedImport)).orderBy(schema.matchDemoStatProjections.projectionVersion),
        audits: await database.select().from(schema.auditLogs).where(eq(schema.auditLogs.targetId, ids.mixedImport)).orderBy(schema.auditLogs.id),
      });
      const beforeMixedSuccess = await mixedSuccessSnapshot();
      expect(beforeMixedSuccess.imports[0]?.status).toBe("needs_attention");
      expect(beforeMixedSuccess.rounds).toHaveLength(0);
      expect(beforeMixedSuccess.projections).toHaveLength(0);

      // Exercise the real fanout owner and its independent transaction, using
      // the provider driver shared by its pool (not a mocked transaction result).
      const originalPoolQuery = Client.prototype.query;
      const batchWrite = vi.spyOn(process.stderr, "write").mockReturnValue(true);
      let batchInjected = false;
      const batchTargetReads: string[] = [];
      const batchQuery = vi.spyOn(Client.prototype, "query").mockImplementation(function (this: Client, ...args: unknown[]) {
        const query = args[0] as { text?: string; values?: unknown[] };
        const bindings = query?.values ?? args[1];
        if (query?.text?.includes('from "match_maps"') && Array.isArray(bindings)) {
          if (bindings.includes(ids.mixedMap)) batchTargetReads.push(ids.mixedMap);
          if (bindings.includes(ids.map)) batchTargetReads.push(ids.map);
        }
        if (query?.text?.includes('from "match_maps"') && Array.isArray(bindings) && bindings.includes(ids.map)) {
          batchInjected = true;
          return Reflect.apply(originalPoolQuery, this, ["SELECT 1 / 0"]);
        }
        return Reflect.apply(originalPoolQuery, this, args);
      });
      try {
        const batch = await revalidateSeasonNeedsAttentionImports({ seasonId: ids.season, actorId: userIds[0]! });
        expect(batchInjected).toBe(true);
        expect(batchTargetReads[0]).toBe(ids.mixedMap);
        expect(batchTargetReads).toContain(ids.map);
        expect(batch).toMatchObject({ attempted: 2, confirmed: 1, remaining: 0, failed: 1, affectedMatchIds: [ids.mixedMatch], requestId: expect.any(String) });
        const event = JSON.parse(String(batchWrite.mock.calls[0][0]));
        expect(event).toMatchObject({ event: "demo.recheck.failure", requestId: batch.requestId, exception: { code: "22012" } });
        expect(JSON.stringify(event)).not.toMatch(/SELECT|payload|token=private/);
      } finally { batchQuery.mockRestore(); batchWrite.mockRestore(); }
      expect(sha256Json(await recheckSnapshot())).toBe(sha256Json(beforeFault));
      const confirmedMixed = await mixedSuccessSnapshot();
      expect(confirmedMixed.imports).toHaveLength(1);
      expect(confirmedMixed.imports[0]).toMatchObject({ status: "confirmed", payload: mixedEvidence,
        payloadSha256: sha256Json(mixedEvidence), issues: [] });
      expect(confirmedMixed.rounds).toHaveLength(mixedEvidence.sourceFacts.rounds.length);
      expect(confirmedMixed.stats).toHaveLength(10);
      expect(confirmedMixed.stats.every(row => row.dakImportId === ids.mixedImport)).toBe(true);
      expect(confirmedMixed.projections.map(row => row.projectionVersion).sort()).toEqual([PREVIOUS_STATISTICS_PROJECTION_VERSION, STATISTICS_PROJECTION_VERSION].sort());
      expect(confirmedMixed.projections.every(row => row.identityBindings.length === 10)).toBe(true);
      expect(confirmedMixed.audits).toHaveLength(1);
      expect(confirmedMixed.audits[0]?.action).toBe("match.demo.recheck");
      const recoveredBatch = await revalidateSeasonNeedsAttentionImports({ seasonId: ids.season, actorId: userIds[0]! });
      expect(recoveredBatch).toMatchObject({ attempted: 1, confirmed: 0, remaining: 1, failed: 0, affectedMatchIds: [ids.match] });
      expect((await readReview()).participants[0]?.state).toBe("confirmable");
      // attempted=1 proves that the next real selection excludes the now
      // confirmed map; all of its committed rows and audit stay byte-identical.
      expect(sha256Json(await mixedSuccessSnapshot())).toBe(sha256Json(confirmedMixed));
      await database.transaction(async tx => {
        // Local fixture teardown only; preserve the original scenario's corpus.
        await tx.execute(sql`SET LOCAL session_replication_role = replica`);
        await tx.delete(schema.matchRoundFacts).where(eq(schema.matchRoundFacts.importId, ids.mixedImport));
        await tx.delete(schema.matchDemoStatProjections).where(eq(schema.matchDemoStatProjections.importId, ids.mixedImport));
        await tx.delete(schema.matchPlayerStats).where(eq(schema.matchPlayerStats.mapId, ids.mixedMap));
        await tx.delete(schema.auditLogs).where(eq(schema.auditLogs.targetId, ids.mixedImport));
        await tx.delete(schema.matchDemoImports).where(eq(schema.matchDemoImports.id, ids.mixedImport));
        await tx.delete(schema.matchMaps).where(eq(schema.matchMaps.id, ids.mixedMap));
        await tx.delete(schema.matchRosterPlayers).where(inArray(schema.matchRosterPlayers.rosterId, [ids.mixedRosterA, ids.mixedRosterB]));
        await tx.delete(schema.matchRosters).where(eq(schema.matchRosters.matchId, ids.mixedMatch));
        await tx.delete(schema.matches).where(eq(schema.matches.id, ids.mixedMatch));
      });

      // An explicit empty target lookup still becomes a business finding. Run
      // the real SELECT with a false predicate, then roll back this probe only.
      const queryBeforeMissing = client.query;
      const probeRollback = new Error("rollback expected unavailable-target probe");
      let missingInjected = false;
      client.query = ((...args: unknown[]) => {
        const query = args[0] as { text?: string };
        if (query?.text?.includes('from "matches"')) {
          missingInjected = true;
          return Reflect.apply(queryBeforeMissing, client, [{ ...query, text: query.text.replace(' for update', ' and false for update') }, ...args.slice(1)]);
        }
        return Reflect.apply(queryBeforeMissing, client, args);
      }) as typeof client.query;
      try {
        await expect(database.transaction(async (tx) => {
          const result = await revalidateStoredDemoImportInTx(tx, { importId: needsIdentity.importId!, actorId: userIds[0]! });
          expect(result).toMatchObject({ status: "needs_attention", issues: [{ code: "STORED_TARGET_INVALID" }] });
          expect(missingInjected).toBe(true);
          throw probeRollback;
        })).rejects.toBe(probeRollback);
      } finally { client.query = queryBeforeMissing; }

      const confirmedByIdentity = await database.transaction((tx) => confirmStoredDemoParticipantIdentityInTx(tx, {
        importId: needsIdentity.importId!,
        observedSteam64: alternateSteam64,
        eventRosterMemberId: eventMemberIds[0]!,
        actorId: userIds[0]!,
      }));
      expect(confirmedByIdentity).toMatchObject({ status: "confirmed", aliasCreated: true, alreadyConfirmed: false, issues: [] });
      const identityRows = await database.select().from(schema.userGameplaySteamIds).where(and(eq(schema.userGameplaySteamIds.sourceImportId, needsIdentity.importId), eq(schema.userGameplaySteamIds.status, "active")));
      expect(identityRows).toHaveLength(1);
      expect(identityRows[0]).toMatchObject({ userId: userIds[0], steam64: alternateSteam64, provenance: "admin_confirmed_alternate", status: "active" });
      expect(await database.select().from(schema.matchDemoImports).where(eq(schema.matchDemoImports.id, needsIdentity.importId))).toMatchObject([
        expect.objectContaining({ status: "confirmed", payload: aliasEvidence, supersedesImportId: revisedImportId }),
      ]);
      expect(await database.select().from(schema.matchRoundFacts).where(eq(schema.matchRoundFacts.importId, needsIdentity.importId))).toHaveLength(aliasEvidence.sourceFacts.rounds.length);
      expect(await database.select().from(schema.auditLogs).where(and(
        eq(schema.auditLogs.targetId, needsIdentity.importId),
        eq(schema.auditLogs.action, "match.demo.identity_confirm"),
      ))).toHaveLength(1);
      expect(await database.select().from(schema.auditLogs).where(and(
        eq(schema.auditLogs.targetId, needsIdentity.importId),
        eq(schema.auditLogs.action, "match.demo.recheck"),
      ))).toHaveLength(2); // recovered batch + identity confirmation

      const idempotentAliasImportId = randomUUID();
      const idempotentAliasEvidence = demoEvidenceContract.parseRivalHubDemoEvidenceV1({
        ...aliasEvidence,
        participants: aliasEvidence.participants.map((participant, index) => index === 0
          ? { ...participant, nameSnapshot: `${participant.nameSnapshot}（重复确认）` }
          : participant),
      });
      await database.insert(schema.matchDemoImports).values({
        id: idempotentAliasImportId,
        seasonId: ids.season,
        matchId: ids.match,
        matchMapId: ids.map,
        stageKey: "fixture-stage",
        stageRunId: null,
        demoSha256: idempotentAliasEvidence.source.demoSha256,
        payloadSha256: sha256Json(idempotentAliasEvidence),
        contractVersion: idempotentAliasEvidence.contract.contractVersion,
        semanticProfile: idempotentAliasEvidence.contract.semanticProfile,
        analysisVersion: idempotentAliasEvidence.contract.analysisVersion,
        evidenceRevision: idempotentAliasEvidence.target.evidenceRevision,
        status: "needs_attention",
        payload: idempotentAliasEvidence,
        submittedByPairingId: ids.pairing,
        idempotencyKey: "dak-identity-idempotent-alias-1",
        supersedesImportId: null,
        issues: [{
          code: "PARTICIPANT_IDENTITY_UNRESOLVED",
          path: `participants.${alternateSteam64}`,
          message: "选手身份未能以 Steam64 唯一匹配，不能自动接收。",
        }],
        submittedAt: new Date(now.getTime() + 2_000),
        confirmedAt: null,
        createdAt: new Date(now.getTime() + 2_000),
      });
      const activeAliasBeforeIdempotency = await database.select().from(schema.userGameplaySteamIds)
        .where(eq(schema.userGameplaySteamIds.userId, userIds[0]!));
      const repeatedAliasConfirmation = await database.transaction((tx) => confirmStoredDemoParticipantIdentityInTx(tx, {
        importId: idempotentAliasImportId,
        observedSteam64: alternateSteam64,
        eventRosterMemberId: eventMemberIds[0]!,
        actorId: userIds[0]!,
      }));
      expect(repeatedAliasConfirmation).toMatchObject({ status: "confirmed", aliasCreated: false, alreadyConfirmed: false, issues: [] });
      expect(await database.select().from(schema.userGameplaySteamIds)
        .where(eq(schema.userGameplaySteamIds.userId, userIds[0]!))).toEqual(activeAliasBeforeIdempotency);

      const [identity] = identityRows;
      if (!identity) throw new Error("测试未保存 gameplay alias");
      // Real two-transaction races in both orders: the retiring workflow must
      // either see the committed confirmation, or validation sees retirement.
      const confirmingClient = await pool.connect();
      const retiringClient = await pool.connect();
      const confirmingDb = drizzle(confirmingClient, { schema }) as unknown as Parameters<typeof revalidateStoredDemoImportInTx>[0];
      const retiringDb = drizzle(retiringClient, { schema }) as unknown as Parameters<typeof retireSeasonGameplaySteamIdentityInTx>[0];
      const confirmingPid = (await confirmingClient.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      const retiringPid = (await retiringClient.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      const retireInput = { identityId: identity.id, seasonId: ids.season, actorId: userIds[0]!, reason: "并发身份撤销测试" };
      let pendingRace: Promise<unknown> | undefined;
      try {
        await database.update(schema.matchDemoImports).set({ status: "needs_attention" }).where(eq(schema.matchDemoImports.id, idempotentAliasImportId));
        await confirmingClient.query("BEGIN");
        expect(await revalidateStoredDemoImportInTx(confirmingDb, { importId: idempotentAliasImportId, actorId: userIds[0]! })).toMatchObject({ status: "confirmed" });
        await retiringClient.query("BEGIN");
        const retiring = retireSeasonGameplaySteamIdentityInTx(retiringDb, retireInput);
        pendingRace = retiring;
        void retiring.catch(() => undefined);
        await waitForAdvisoryWait(client, retiringPid);
        await confirmingClient.query("COMMIT");
        await retiring;
        expect((await retiringDb.select({ status: schema.matchDemoImports.status }).from(schema.matchDemoImports)
          .where(eq(schema.matchDemoImports.id, idempotentAliasImportId)))[0]?.status).toBe("needs_attention");
        await retiringClient.query("ROLLBACK");
        pendingRace = undefined;

        await retiringClient.query("BEGIN");
        await retireSeasonGameplaySteamIdentityInTx(retiringDb, retireInput);
        await confirmingClient.query("BEGIN");
        const confirming = revalidateStoredDemoImportInTx(confirmingDb, { importId: idempotentAliasImportId, actorId: userIds[0]! });
        pendingRace = confirming;
        void confirming.catch(() => undefined);
        await waitForAdvisoryWait(client, confirmingPid);
        await retiringClient.query("COMMIT");
        expect(await confirming).toMatchObject({ status: "needs_attention", issues: expect.arrayContaining([expect.objectContaining({ code: "PARTICIPANT_IDENTITY_UNRESOLVED" })]) });
        await confirmingClient.query("ROLLBACK");
        pendingRace = undefined;
      } finally {
        // Release either holder before awaiting a blocked statement on the other.
        await Promise.all([confirmingClient.query("ROLLBACK").catch(() => {}), retiringClient.query("ROLLBACK").catch(() => {})]);
        await pendingRace?.catch(() => undefined);
        confirmingClient.release();
        retiringClient.release();
      }
      // Restore this fixture's active alias for the independent scoped-retire assertions.
      await database.update(schema.userGameplaySteamIds).set({ status: "active", retiredByUserId: null, retiredAt: null, retiredReason: null })
        .where(eq(schema.userGameplaySteamIds.id, identity.id));
      await database.transaction((tx) => revalidateStoredDemoImportInTx(tx, { importId: idempotentAliasImportId, actorId: userIds[0]! }));

      const retired = await database.transaction((tx) => retireSeasonGameplaySteamIdentityInTx(tx, {
        identityId: identity.id,
        seasonId: ids.season,
        actorId: userIds[0]!,
        reason: "测试撤销错误身份确认",
      }));
      expect(retired).toEqual({ retired: true });
      expect((await database.select({ status: schema.matchDemoImports.status }).from(schema.matchDemoImports)
        .where(eq(schema.matchDemoImports.id, idempotentAliasImportId)))[0]?.status).toBe("needs_attention");
      await expect(getTournamentStats({ seasonId: ids.season }, database)).resolves.toMatchObject({ coverage: { detailedMaps: 0 } });
      expect(await database.select().from(schema.userGameplaySteamIds).where(eq(schema.userGameplaySteamIds.id, identity.id))).toMatchObject([
        expect.objectContaining({ status: "retired", retiredReason: "测试撤销错误身份确认" }),
      ]);
      await expect(database.transaction((tx) => retireSeasonGameplaySteamIdentityInTx(tx, {
        identityId: identity.id,
        seasonId: randomUUID(),
        actorId: userIds[0]!,
        reason: "跨赛季猜测撤销",
      }))).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

      const profileChangeIdentityId = randomUUID();
      await database.insert(schema.userGameplaySteamIds).values({
        id: profileChangeIdentityId,
        userId: userIds[1]!,
        steam64: "76561198123456780",
        status: "active",
        provenance: "profile_change",
        sourceImportId: null,
        confirmedByUserId: userIds[1]!,
        confirmedAt: now,
        reason: "用户更换当前 Steam64，保留历史游戏身份。",
      });
      await expect(database.transaction((tx) => retireSeasonGameplaySteamIdentityInTx(tx, {
        identityId: profileChangeIdentityId,
        seasonId: ids.season,
        actorId: userIds[0]!,
        reason: "赛事管理员尝试撤销 profile_change",
      }))).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
      expect(await database.select().from(schema.userGameplaySteamIds).where(eq(schema.userGameplaySteamIds.id, profileChangeIdentityId))).toMatchObject([
        expect.objectContaining({ status: "active", provenance: "profile_change" }),
      ]);

      const retiredAliasEvidence = demoEvidenceContract.parseRivalHubDemoEvidenceV1({
        ...aliasEvidence,
        participants: aliasEvidence.participants.map((participant, index) => index === 0
          ? { ...participant, nameSnapshot: `${participant.nameSnapshot}（撤销后）` }
          : participant),
      });
      const retiredAliasRetry = await submitRivalHubEvidence({
        input: retiredAliasEvidence,
        pairingId: ids.pairing,
        pairingScope: { seasonIds: [ids.season] },
        idempotencyKey: "dak-retired-alias-review-1",
      });
      expect(retiredAliasRetry.status).toBe("needs_attention");
      expect(retiredAliasRetry.issues.some((row) => row.code === "PARTICIPANT_IDENTITY_UNRESOLVED")).toBe(true);

      const primaryIdempotentImportId = randomUUID();
      const primaryIdempotentEvidence = demoEvidenceContract.parseRivalHubDemoEvidenceV1({
        ...evidenceNPlusOne,
        participants: evidenceNPlusOne.participants.map((participant, index) => index === 0
          ? { ...participant, nameSnapshot: `${participant.nameSnapshot}（主身份已恢复）`, resolution: { status: "unresolved" } }
          : participant),
      });
      await database.insert(schema.matchDemoImports).values({
        id: primaryIdempotentImportId,
        seasonId: ids.season,
        matchId: ids.match,
        matchMapId: ids.map,
        stageKey: "fixture-stage",
        stageRunId: null,
        demoSha256: primaryIdempotentEvidence.source.demoSha256,
        payloadSha256: sha256Json(primaryIdempotentEvidence),
        contractVersion: primaryIdempotentEvidence.contract.contractVersion,
        semanticProfile: primaryIdempotentEvidence.contract.semanticProfile,
        analysisVersion: primaryIdempotentEvidence.contract.analysisVersion,
        evidenceRevision: primaryIdempotentEvidence.target.evidenceRevision,
        status: "needs_attention",
        payload: primaryIdempotentEvidence,
        submittedByPairingId: ids.pairing,
        idempotencyKey: "dak-identity-idempotent-primary-1",
        supersedesImportId: null,
        issues: [{
          code: "PARTICIPANT_IDENTITY_UNRESOLVED",
          path: `participants.${primarySteam64}`,
          message: "选手身份未能以 Steam64 唯一匹配，不能自动接收。",
        }],
        submittedAt: new Date(now.getTime() + 3_000),
        confirmedAt: null,
        createdAt: new Date(now.getTime() + 3_000),
      });
      const primaryIdentityBeforeIdempotency = await database.select().from(schema.userGameplaySteamIds)
        .where(eq(schema.userGameplaySteamIds.userId, userIds[0]!));
      const repeatedPrimaryConfirmation = await database.transaction((tx) => confirmStoredDemoParticipantIdentityInTx(tx, {
        importId: primaryIdempotentImportId,
        observedSteam64: primarySteam64,
        eventRosterMemberId: eventMemberIds[0]!,
        actorId: userIds[0]!,
      }));
      expect(repeatedPrimaryConfirmation).toMatchObject({ status: "confirmed", aliasCreated: false, alreadyConfirmed: false, issues: [] });
      expect(await database.select().from(schema.userGameplaySteamIds)
        .where(eq(schema.userGameplaySteamIds.userId, userIds[0]!))).toEqual(primaryIdentityBeforeIdempotency);

      const scoreOnlyEvidence = demoEvidenceContract.parseRivalHubDemoEvidenceV1({
        ...evidenceNPlusOne,
        quality: {
          ...evidenceNPlusOne.quality,
          qa: { ...evidenceNPlusOne.quality.qa, ok: false, issueCount: 1, errorCount: 1 },
        },
      });
      const scoreOnly = await submitRivalHubEvidence({
        input: scoreOnlyEvidence,
        pairingId: ids.pairing,
        pairingScope: { seasonIds: [ids.season] },
        idempotencyKey: "dak-score-only-review-1",
      });
      expect(scoreOnly.status).toBe("needs_attention");
      expect(scoreOnly.issues.some((row) => row.code === "DAK_QA_FAILED")).toBe(true);
      expect(scoreOnly.issues.some((row) => row.code === "PARTICIPANT_IDENTITY_UNRESOLVED")).toBe(false);
      if (!scoreOnly.importId) throw new Error("测试未创建比分/QA 待处理 Demo");
      const aliasesBeforeScoreOnlyConfirm = await database.select().from(schema.userGameplaySteamIds);
      await expect(database.transaction((tx) => confirmStoredDemoParticipantIdentityInTx(tx, {
        importId: scoreOnly.importId!,
        observedSteam64: primarySteam64,
        eventRosterMemberId: eventMemberIds[0]!,
        actorId: userIds[0]!,
      }))).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
      expect(await database.select().from(schema.userGameplaySteamIds)).toEqual(aliasesBeforeScoreOnlyConfirm);
      await database.transaction((tx) => rejectStoredDemoImportInTx(tx, { importId: scoreOnly.importId!, actorId: userIds[0]! }));

      const conflictingSteam64 = "76561198123456781";
      await database.transaction((tx) => recordGameplaySteamIdentityInTx(tx, {
        userId: userIds[5]!,
        steam64: conflictingSteam64,
        actorId: userIds[5]!,
        provenance: "admin_confirmed_alternate",
        reason: "测试跨用户 gameplay alias 冲突。",
      }));
      const crossUserEvidence = demoEvidenceContract.parseRivalHubDemoEvidenceV1(JSON.parse(
        JSON.stringify({ ...evidenceNPlusOne, source: { ...evidenceNPlusOne.source, demoSha256: "d".repeat(64) } })
          .replaceAll(primarySteam64, conflictingSteam64),
      ) as unknown);
      crossUserEvidence.participants[0] = {
        ...crossUserEvidence.participants[0]!,
        resolution: { status: "unresolved" },
      };
      const crossUserReview = await submitRivalHubEvidence({
        input: crossUserEvidence,
        pairingId: ids.pairing,
        pairingScope: { seasonIds: [ids.season] },
        idempotencyKey: "dak-cross-user-confirm-review-1",
      });
      expect(crossUserReview.status).toBe("needs_attention");
      expect(crossUserReview.importId).not.toBeNull();
      if (!crossUserReview.importId) throw new Error("测试未创建跨用户身份冲突 Demo");
      const aliasesBeforeCrossUserConfirm = await database.select().from(schema.userGameplaySteamIds);
      await expect(database.transaction((tx) => confirmStoredDemoParticipantIdentityInTx(tx, {
        importId: crossUserReview.importId!,
        observedSteam64: conflictingSteam64,
        eventRosterMemberId: eventMemberIds[0]!,
        actorId: userIds[0]!,
      }))).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED, message: GAMEPLAY_STEAM_CONFLICT_MESSAGE });
      expect(await database.select().from(schema.userGameplaySteamIds)).toEqual(aliasesBeforeCrossUserConfirm);

      const insertLineageImport = async (input: {
        id: string;
        evidence: RivalHubEvidenceSubmission;
        status: "confirmed" | "needs_attention" | "stale";
        createdAt: Date;
        issues?: readonly { code: string; path?: string; message: string }[];
      }) => {
        await database.insert(schema.matchDemoImports).values({
          id: input.id,
          seasonId: ids.season,
          matchId: ids.match,
          matchMapId: ids.map,
          stageKey: input.evidence.target.stageKey,
          stageRunId: input.evidence.target.stageRunId ?? null,
          demoSha256: input.evidence.source.demoSha256,
          payloadSha256: sha256Json(input.evidence),
          contractVersion: input.evidence.contract.contractVersion,
          semanticProfile: input.evidence.contract.semanticProfile,
          analysisVersion: input.evidence.contract.analysisVersion,
          evidenceRevision: input.evidence.target.evidenceRevision,
          status: input.status,
          payload: input.evidence,
          submittedByPairingId: ids.pairing,
          idempotencyKey: `dak-lineage-${input.id}`,
          supersedesImportId: null,
          issues: input.issues ?? [],
          submittedAt: input.createdAt,
          confirmedAt: input.status === "confirmed" ? input.createdAt : null,
          createdAt: input.createdAt,
        });
      };
      const lineageEvidence = (suffix: string) => demoEvidenceContract.parseRivalHubDemoEvidenceV1({
        ...evidenceNPlusOne,
        participants: evidenceNPlusOne.participants.map((participant, index) => index === 0
          ? { ...participant, nameSnapshot: `Fixture Player 01 (${suffix})` }
          : participant),
      });
      const lineageNeedsAttentionId = randomUUID();
      await insertLineageImport({
        id: lineageNeedsAttentionId,
        evidence: lineageEvidence("newer-needs-attention"),
        status: "needs_attention",
        createdAt: new Date(now.getTime() + 4_000),
        issues: [{ code: "DAK_QA_FAILED", path: "quality.qa", message: "测试中的历史 QA 问题。" }],
      });
      const lineageCurrent = await submitRivalHubEvidence({
        input: lineageEvidence("current-after-needs-attention"),
        pairingId: ids.pairing,
        pairingScope: { seasonIds: [ids.season] },
        idempotencyKey: "dak-lineage-current-after-needs-attention-1",
      });
      expect(lineageCurrent.status).toBe("synced");
      if (!lineageCurrent.importId) throw new Error("测试未创建 needs_attention lineage promotion Demo");
      const afterNeedsAttentionPromotion = await database.select().from(schema.matchDemoImports)
        .where(eq(schema.matchDemoImports.matchMapId, ids.map));
      expect(afterNeedsAttentionPromotion.find((row) => row.id === primaryIdempotentImportId)).toMatchObject({ status: "superseded" });
      expect(afterNeedsAttentionPromotion.find((row) => row.id === lineageNeedsAttentionId)).toMatchObject({ status: "superseded" });
      expect(afterNeedsAttentionPromotion.find((row) => row.id === lineageCurrent.importId)).toMatchObject({
        status: "confirmed",
        supersedesImportId: primaryIdempotentImportId,
      });
      expect(afterNeedsAttentionPromotion.filter((row) => row.demoSha256 === evidenceNPlusOne.source.demoSha256 && row.status === "confirmed")).toHaveLength(1);

      const staleLineageId = randomUUID();
      await insertLineageImport({
        id: staleLineageId,
        evidence: lineageEvidence("newer-stale"),
        status: "stale",
        createdAt: new Date(now.getTime() + 5_000),
        issues: [{ code: "STALE_EVIDENCE", path: "target.evidenceRevision", message: "测试中的历史 stale 来源。" }],
      });
      const lineageAfterStale = await submitRivalHubEvidence({
        input: lineageEvidence("current-after-stale"),
        pairingId: ids.pairing,
        pairingScope: { seasonIds: [ids.season] },
        idempotencyKey: "dak-lineage-current-after-stale-1",
      });
      expect(lineageAfterStale.status).toBe("synced");
      if (!lineageAfterStale.importId) throw new Error("测试未创建 stale lineage promotion Demo");
      const afterStalePromotion = await database.select().from(schema.matchDemoImports)
        .where(eq(schema.matchDemoImports.matchMapId, ids.map));
      expect(afterStalePromotion.find((row) => row.id === lineageCurrent.importId)).toMatchObject({ status: "superseded" });
      expect(afterStalePromotion.find((row) => row.id === staleLineageId)).toMatchObject({ status: "superseded" });
      expect(afterStalePromotion.find((row) => row.id === lineageAfterStale.importId)).toMatchObject({
        status: "confirmed",
        supersedesImportId: lineageCurrent.importId,
      });
      expect(afterStalePromotion.filter((row) => row.demoSha256 === evidenceNPlusOne.source.demoSha256 && row.status === "confirmed")).toHaveLength(1);

      const differentDemoConfirmedId = randomUUID();
      const differentDemoBase = lineageEvidence("different-demo-confirmed");
      const differentDemoEvidence = demoEvidenceContract.parseRivalHubDemoEvidenceV1({
        ...differentDemoBase,
        source: { ...differentDemoBase.source, demoSha256: "e".repeat(64) },
      });
      await insertLineageImport({
        id: differentDemoConfirmedId,
        evidence: differentDemoEvidence,
        status: "confirmed",
        createdAt: new Date(now.getTime() + 6_000),
      });
      const contentConflict = await submitRivalHubEvidence({
        input: lineageEvidence("content-conflict"),
        pairingId: ids.pairing,
        pairingScope: { seasonIds: [ids.season] },
        idempotencyKey: "dak-lineage-different-demo-conflict-1",
      });
      expect(contentConflict.status).toBe("needs_attention");
      expect(contentConflict.issues).toEqual([
        expect.objectContaining({ code: "CONTENT_CONFLICT", path: "source.demoSha256" }),
      ]);
      const afterDifferentDemoConflict = await database.select().from(schema.matchDemoImports)
        .where(eq(schema.matchDemoImports.matchMapId, ids.map));
      expect(afterDifferentDemoConflict.find((row) => row.id === differentDemoConfirmedId)).toMatchObject({ status: "confirmed" });
      expect(afterDifferentDemoConflict.find((row) => row.id === lineageAfterStale.importId)).toMatchObject({ status: "confirmed" });
      expect(afterDifferentDemoConflict.find((row) => row.id === contentConflict.importId)).toMatchObject({ status: "needs_attention" });
      const allowedScoreboardPlayers = await loadScoreboardPlayers(database, ids.match, [ids.entryA, ids.entryB]);
      expect(new Set(allowedScoreboardPlayers.map(row => row.userId))).toEqual(new Set(userIds));
      await database.insert(schema.matchPlayerStats).values({ matchId: ids.match, mapId: ids.map, perfectName: "OCR-only unmatched player", ratingPro: 1.1 });
      const canonicalBeforeClear = await database.select().from(schema.matchPlayerStats).where(eq(schema.matchPlayerStats.mapId, ids.map));
      expect(canonicalBeforeClear.filter(row => row.dakImportId)).toHaveLength(10);
      expect(canonicalBeforeClear.filter(row => !row.dakImportId)).toHaveLength(1);
      const importsBeforeClear = await database.select().from(schema.matchDemoImports).where(eq(schema.matchDemoImports.matchMapId, ids.map));
      const factsBeforeClear = await database.select().from(schema.matchRoundFacts).where(eq(schema.matchRoundFacts.importId, lineageAfterStale.importId));
      const operatorBeforeClear = await loadOperatorScoreboard(database, ids.map);
      expect(Object.keys(operatorBeforeClear[0]).sort()).toEqual(["adr", "assists", "clutches", "deaths", "firstKills", "gameplayLocked", "hsPercent", "kills", "multiKills", "perfectName", "ratingPro", "rws", "userId", "we"]);
      expect(operatorBeforeClear.filter(row => row.gameplayLocked)).toHaveLength(10);
      expect(operatorBeforeClear.find(row => !row.gameplayLocked)).toMatchObject({ perfectName: "OCR-only unmatched player", ratingPro: 1.1, gameplayLocked: false });
      const dakGameplayBeforeClear = operatorBeforeClear.filter(row => row.gameplayLocked).map(row => [row.perfectName, row.kills, row.deaths, row.adr]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      await database.transaction(tx => clearOperatorScoreboardInTx(tx, ids.map));
      const canonicalAfterClear = await database.select().from(schema.matchPlayerStats).where(eq(schema.matchPlayerStats.mapId, ids.map));
      expect(canonicalAfterClear.sort((a, b) => a.id.localeCompare(b.id))).toEqual(canonicalBeforeClear.filter(row => row.dakImportId).map(row => ({ ...row, ratingPro: null, rws: null, we: null })).sort((a, b) => a.id.localeCompare(b.id)));
      expect(await database.select().from(schema.matchDemoImports).where(eq(schema.matchDemoImports.matchMapId, ids.map))).toEqual(importsBeforeClear);
      expect(await database.select().from(schema.matchRoundFacts).where(eq(schema.matchRoundFacts.importId, lineageAfterStale.importId))).toEqual(factsBeforeClear);
      const operatorAfterClear = await loadOperatorScoreboard(database, ids.map);
      expect(operatorAfterClear).toHaveLength(10);
      expect(operatorAfterClear.every(row => row.gameplayLocked)).toBe(true);
      expect(operatorAfterClear.every(row => row.ratingPro === null && row.rws === null && row.we === null)).toBe(true);
      expect(operatorAfterClear.map(row => [row.perfectName, row.kills, row.deaths, row.adr]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))).toEqual(dakGameplayBeforeClear);

      // Receiver-first extension: actual persistence + same-Demo lineage, without
      // rewriting the legacy artifact/hash or changing any gameplay facts.
      const oldCareer = (await database.select().from(schema.matchDemoImports)
        .where(eq(schema.matchDemoImports.id, secondEventImport.importId!)))[0]!;
      const diagnosticEvidence = structuredClone(secondEventEvidence);
      diagnosticEvidence.source.producerVersion = "cs2dak-rivalhub-evidence/0.2.0";
      diagnosticEvidence.quality.qa = { ok: true, issueCount: 1, warningCount: 1, errorCount: 0 };
      diagnosticEvidence.quality.capabilities.richKills = "partial";
      diagnosticEvidence.extensions["cs2dak/diagnostics"] = {
        version: 1,
        qa: { issues: [{ severity: "warning", code: "future.coverage", path: "kills", message: "Source coverage is incomplete." }], omittedIssueCount: 0 },
        richKills: { eventCount: diagnosticEvidence.sourceFacts.kills.length, flagsEventCount: diagnosticEvidence.sourceFacts.kills.length,
          namedActiveWeaponEventCount: 0, reason: "no_named_active_weapon" },
      };
      const diagnosticArgs = { input: diagnosticEvidence, pairingId: ids.pairing,
        pairingScope: { seasonIds: careerSeasonScope }, idempotencyKey: "dak-quality-diagnostics-1" };
      await expect(submitRivalHubEvidence({ ...diagnosticArgs, idempotencyKey: "dak-career-second-event-1" })).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
      const diagnosticResult = await submitRivalHubEvidence(diagnosticArgs);
      expect(diagnosticResult).toMatchObject({ status: "synced", issues: [] });
      expect(diagnosticResult.importId).not.toBe(oldCareer.id);
      expect(await submitRivalHubEvidence(diagnosticArgs)).toEqual(diagnosticResult);
      const careerImports = await database.select().from(schema.matchDemoImports).where(eq(schema.matchDemoImports.matchMapId, ids.careerMap));
      const currentCareer = careerImports.find(row => row.id === diagnosticResult.importId)!;
      expect(currentCareer).toMatchObject({ status: "confirmed", supersedesImportId: oldCareer.id, payload: diagnosticEvidence, payloadSha256: sha256Json(diagnosticEvidence) });
      expect(careerImports.find(row => row.id === oldCareer.id)).toMatchObject({ status: "superseded", payload: oldCareer.payload, payloadSha256: oldCareer.payloadSha256 });
      expect(diagnosticEvidence.sourceFacts).toEqual(secondEventEvidence.sourceFacts);
      expect(diagnosticEvidence.semanticFacts).toEqual(secondEventEvidence.semanticFacts);
      expect(diagnosticEvidence.summaries).toEqual(secondEventEvidence.summaries);
      const quality = projectAdminDemoQuality(currentCareer, { mapOrder: 1, mapName: "de_nuke" });
      expect(quality).toMatchObject({ summary: "QA 检查通过：0 条错误，1 条警告。", issues: [{ code: "future.coverage", path: "kills", label: "警告", message: "Source coverage is incomplete." }] });
      expect(quality.capabilityReason).toContain("未观察到可识别的当前武器");
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      await client.query("BEGIN").catch(() => {});
      // Fixture teardown intentionally bypasses immutable/append-only row
      // triggers, matching the repository's other integration cleanups.
      await client.query("SET LOCAL session_replication_role = replica").catch(() => {});
      // replica disables FK cascades, so remove every projection version before imports.
      await client.query("DELETE FROM match_demo_stat_projections WHERE import_id IN (SELECT id FROM match_demo_imports WHERE match_map_id = ANY($1::uuid[]))", [[ids.map, ids.careerMap, ids.mixedMap]]).catch(() => {});
      await client.query("DELETE FROM match_round_facts WHERE import_id = $1", [ids.mixedImport]).catch(() => {});
      await client.query("DELETE FROM match_player_stats WHERE map_id = $1", [ids.mixedMap]).catch(() => {});
      await client.query("DELETE FROM match_demo_imports WHERE id = $1", [ids.mixedImport]).catch(() => {});
      await client.query("DELETE FROM match_maps WHERE id = $1", [ids.mixedMap]).catch(() => {});
      await client.query("DELETE FROM match_roster_players WHERE roster_id IN ($1, $2)", [ids.mixedRosterA, ids.mixedRosterB]).catch(() => {});
      await client.query("DELETE FROM match_rosters WHERE match_id = $1", [ids.mixedMatch]).catch(() => {});
      await client.query("DELETE FROM matches WHERE id = $1", [ids.mixedMatch]).catch(() => {});
      await client.query("DELETE FROM match_round_facts WHERE import_id IN (SELECT id FROM match_demo_imports WHERE match_map_id = $1)", [ids.map]).catch(() => {});
      await client.query("DELETE FROM match_player_stats WHERE map_id = $1", [ids.map]).catch(() => {});
      await client.query("DELETE FROM match_demo_imports WHERE match_map_id = $1", [ids.map]).catch(() => {});
      await client.query("DELETE FROM match_round_facts WHERE import_id IN (SELECT id FROM match_demo_imports WHERE match_map_id = $1)", [ids.careerMap]).catch(() => {});
      await client.query("DELETE FROM match_player_stats WHERE map_id = $1", [ids.careerMap]).catch(() => {});
      await client.query("DELETE FROM match_demo_imports WHERE match_map_id = $1", [ids.careerMap]).catch(() => {});
      await client.query("DELETE FROM audit_logs WHERE season_id = $1", [ids.season]).catch(() => {});
      await client.query("DELETE FROM audit_logs WHERE season_id = $1", [ids.careerSeason]).catch(() => {});
      await client.query("DELETE FROM user_gameplay_steam_ids WHERE user_id = ANY($1::uuid[])", [userIds]).catch(() => {});
      await client.query("DELETE FROM dak_pairings WHERE id = $1", [ids.pairing]).catch(() => {});
      await client.query("DELETE FROM dak_pairing_intents WHERE id = $1", [ids.pairingIntent]).catch(() => {});
      await client.query("DELETE FROM match_roster_players WHERE roster_id IN ($1, $2)", [ids.rosterA, ids.rosterB]).catch(() => {});
      await client.query("DELETE FROM match_rosters WHERE id IN ($1, $2)", [ids.rosterA, ids.rosterB]).catch(() => {});
      await client.query("DELETE FROM match_roster_players WHERE roster_id IN ($1, $2)", [ids.careerRosterA, ids.careerRosterB]).catch(() => {});
      await client.query("DELETE FROM match_rosters WHERE id IN ($1, $2)", [ids.careerRosterA, ids.careerRosterB]).catch(() => {});
      await client.query("DELETE FROM match_maps WHERE id = $1", [ids.map]).catch(() => {});
      await client.query("DELETE FROM match_maps WHERE id = $1", [ids.careerMap]).catch(() => {});
      await client.query("DELETE FROM matches WHERE id = $1", [ids.match]).catch(() => {});
      await client.query("DELETE FROM matches WHERE id = $1", [ids.careerMatch]).catch(() => {});
      await client.query("DELETE FROM event_roster_members WHERE id = ANY($1::uuid[])", [eventMemberIds]).catch(() => {});
      await client.query("DELETE FROM event_roster_members WHERE id = ANY($1::uuid[])", [careerEventMemberIds]).catch(() => {});
      await client.query("DELETE FROM event_rosters WHERE id IN ($1, $2)", [ids.eventRosterA, ids.eventRosterB]).catch(() => {});
      await client.query("DELETE FROM event_rosters WHERE id IN ($1, $2)", [ids.careerEventRosterA, ids.careerEventRosterB]).catch(() => {});
      await client.query("DELETE FROM competition_entry_roster_members WHERE id = ANY($1::uuid[])", [rosterMemberIds]).catch(() => {});
      await client.query("DELETE FROM competition_entry_roster_members WHERE id = ANY($1::uuid[])", [careerRosterMemberIds]).catch(() => {});
      await client.query("DELETE FROM competition_entry_participants WHERE id = ANY($1::uuid[])", [participantIds]).catch(() => {});
      await client.query("DELETE FROM competition_entry_participants WHERE id = ANY($1::uuid[])", [careerParticipantIds]).catch(() => {});
      await client.query("DELETE FROM competition_entry_roster_revisions WHERE id IN ($1, $2)", [ids.revisionA, ids.revisionB]).catch(() => {});
      await client.query("DELETE FROM competition_entry_roster_revisions WHERE id IN ($1, $2)", [ids.careerRevisionA, ids.careerRevisionB]).catch(() => {});
      await client.query("DELETE FROM competition_entry_representative_changes WHERE entry_id IN ($1, $2)", [ids.entryA, ids.entryB]).catch(() => {});
      await client.query("DELETE FROM competition_entry_representative_changes WHERE entry_id IN ($1, $2)", [ids.careerEntryA, ids.careerEntryB]).catch(() => {});
      await client.query("DELETE FROM competition_entries WHERE id IN ($1, $2)", [ids.entryA, ids.entryB]).catch(() => {});
      await client.query("DELETE FROM competition_entries WHERE id IN ($1, $2)", [ids.careerEntryA, ids.careerEntryB]).catch(() => {});
      await client.query("DELETE FROM seasons WHERE id = $1", [ids.season]).catch(() => {});
      await client.query("DELETE FROM seasons WHERE id = $1", [ids.careerSeason]).catch(() => {});
      await client.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]).catch(() => {});
      await client.query("COMMIT").catch(() => {});
      client.release();
      await pool.end();
    }
  });
});
