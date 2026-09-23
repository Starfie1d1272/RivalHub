import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { buildTournamentAnalytics, buildTournamentPerformanceAnalytics } from "@cs2dak/tournament";
import { describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import { loadAdminDemoReview } from "../../../src/lib/admin/matches/demo-review";
import { loadCanonicalTarget } from "../../../src/lib/demo-integration/validation";
import { ErrorCode } from "../../../src/lib/errors";
import { parseRivalHubDemoEvidenceV1 } from "../../../src/lib/demo-evidence/contract";
import type { RivalHubEvidenceSubmission } from "../../../src/lib/demo-integration/contracts";
import { lockDemoImportLineageInTx } from "../../../src/lib/demo-integration/promotion";
import { readRivalHubEvents } from "../../../src/lib/demo-integration/read";
import { buildEvidenceRevision, sha256Json } from "../../../src/lib/demo-integration/revision";
import {
  confirmStoredDemoParticipantIdentityInTx,
  GAMEPLAY_STEAM_CONFLICT_MESSAGE,
  rejectStoredDemoImportInTx,
  retireSeasonGameplaySteamIdentityInTx,
} from "../../../src/lib/demo-integration/review";
import { dakStableScoreboardValues, submitRivalHubEvidence } from "../../../src/lib/demo-integration/submit";
import { recordGameplaySteamIdentityInTx } from "../../../src/lib/identity/gameplay-steam";
import { getTournamentMapDetail, getTournamentStats } from "../../../src/lib/stats/tournament-query";
import { adaptStatsEvidence } from "../../../src/lib/stats/evidence-adapter";
import { createLocalPool } from "./harness/database";

const fixturePath = resolve(process.cwd(), "tests/fixtures/demo-evidence/normal-map-v1.json");

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
      rosterA: randomUUID(),
      rosterB: randomUUID(),
      pairingIntent: randomUUID(),
      pairing: randomUUID(),
      ocrStat: randomUUID(),
      legacyImport: randomUUID(),
    };
    const userIds = Array.from({ length: 10 }, () => randomUUID());
    const participantIds = userIds.map(() => randomUUID());
    const eventMemberIds = userIds.map(() => randomUUID());
    const rosterMemberIds = userIds.map(() => randomUUID());
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

      const fixture = parseRivalHubDemoEvidenceV1(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown);
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
      const legacyEvidence = parseRivalHubDemoEvidenceV1({
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
      const stats = await getTournamentStats({ seasonId: ids.season }, observedDatabase);
      const importQueries = queryLog.filter((query) => /from "match_demo_imports"/i.test(query));
      const metadataQuery = importQueries.find((query) => !query.includes('"payload"'));
      const payloadQuery = importQueries.find((query) => query.includes('"payload"'));
      expect(importQueries).toHaveLength(2);
      expect(metadataQuery).toContain('"created_at"');
      expect(payloadQuery).toMatch(/where .*"id" in \(\$1\)/i);
      expect(queryBindings[queryLog.indexOf(payloadQuery!)]).toEqual([importId]);
      expect(queryBindings[queryLog.indexOf(payloadQuery!)]).not.toContain(ids.legacyImport);
      expect(queryBindings[queryLog.indexOf(payloadQuery!)]).not.toContain(conflictBeforePromotionId);
      expect(stats.coverage).toEqual({
        detailedMaps: 1,
        completedMaps: 1,
        maps: [{ mapName: "de_ancient", completedMaps: 1, detailedMaps: 1 }],
      });
      expect(stats.performance.players).toHaveLength(10);
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
      const mapDetail = await getTournamentMapDetail({ seasonId: ids.season, map: "de_ancient" }, observedDatabase);
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
      expect(queryLog.filter((query) => /from "match_demo_imports"/i.test(query) && query.includes('"payload"'))).toHaveLength(1);
      const revisedCompletedAt = new Date(now.getTime() + 1_000);
      await database.update(schema.matchMaps).set({ completedAt: revisedCompletedAt }).where(eq(schema.matchMaps.id, ids.map));
      expect((await getTournamentStats({ seasonId: ids.season }, database)).coverage.detailedMaps).toBe(0);
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
      const aliasEvidence = parseRivalHubDemoEvidenceV1(JSON.parse(
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
      ))).toHaveLength(1);

      const idempotentAliasImportId = randomUUID();
      const idempotentAliasEvidence = parseRivalHubDemoEvidenceV1({
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
      const retired = await database.transaction((tx) => retireSeasonGameplaySteamIdentityInTx(tx, {
        identityId: identity.id,
        seasonId: ids.season,
        actorId: userIds[0]!,
        reason: "测试撤销错误身份确认",
      }));
      expect(retired).toEqual({ retired: true });
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

      const retiredAliasEvidence = parseRivalHubDemoEvidenceV1({
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
      const primaryIdempotentEvidence = parseRivalHubDemoEvidenceV1({
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

      const scoreOnlyEvidence = parseRivalHubDemoEvidenceV1({
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
      const crossUserEvidence = parseRivalHubDemoEvidenceV1(JSON.parse(
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
      const lineageEvidence = (suffix: string) => parseRivalHubDemoEvidenceV1({
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
      const differentDemoEvidence = parseRivalHubDemoEvidenceV1({
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
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      await client.query("BEGIN").catch(() => {});
      // Fixture teardown intentionally bypasses immutable/append-only row
      // triggers, matching the repository's other integration cleanups.
      await client.query("SET LOCAL session_replication_role = replica").catch(() => {});
      await client.query("DELETE FROM match_round_facts WHERE import_id IN (SELECT id FROM match_demo_imports WHERE match_map_id = $1)", [ids.map]).catch(() => {});
      await client.query("DELETE FROM match_player_stats WHERE map_id = $1", [ids.map]).catch(() => {});
      await client.query("DELETE FROM match_demo_imports WHERE match_map_id = $1", [ids.map]).catch(() => {});
      await client.query("DELETE FROM audit_logs WHERE season_id = $1", [ids.season]).catch(() => {});
      await client.query("DELETE FROM user_gameplay_steam_ids WHERE user_id = ANY($1::uuid[])", [userIds]).catch(() => {});
      await client.query("DELETE FROM dak_pairings WHERE id = $1", [ids.pairing]).catch(() => {});
      await client.query("DELETE FROM dak_pairing_intents WHERE id = $1", [ids.pairingIntent]).catch(() => {});
      await client.query("DELETE FROM match_roster_players WHERE roster_id IN ($1, $2)", [ids.rosterA, ids.rosterB]).catch(() => {});
      await client.query("DELETE FROM match_rosters WHERE id IN ($1, $2)", [ids.rosterA, ids.rosterB]).catch(() => {});
      await client.query("DELETE FROM match_maps WHERE id = $1", [ids.map]).catch(() => {});
      await client.query("DELETE FROM matches WHERE id = $1", [ids.match]).catch(() => {});
      await client.query("DELETE FROM event_roster_members WHERE id = ANY($1::uuid[])", [eventMemberIds]).catch(() => {});
      await client.query("DELETE FROM event_rosters WHERE id IN ($1, $2)", [ids.eventRosterA, ids.eventRosterB]).catch(() => {});
      await client.query("DELETE FROM competition_entry_roster_members WHERE id = ANY($1::uuid[])", [rosterMemberIds]).catch(() => {});
      await client.query("DELETE FROM competition_entry_participants WHERE id = ANY($1::uuid[])", [participantIds]).catch(() => {});
      await client.query("DELETE FROM competition_entry_roster_revisions WHERE id IN ($1, $2)", [ids.revisionA, ids.revisionB]).catch(() => {});
      await client.query("DELETE FROM competition_entry_representative_changes WHERE entry_id IN ($1, $2)", [ids.entryA, ids.entryB]).catch(() => {});
      await client.query("DELETE FROM competition_entries WHERE id IN ($1, $2)", [ids.entryA, ids.entryB]).catch(() => {});
      await client.query("DELETE FROM seasons WHERE id = $1", [ids.season]).catch(() => {});
      await client.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]).catch(() => {});
      await client.query("COMMIT").catch(() => {});
      client.release();
      await pool.end();
    }
  });
});
