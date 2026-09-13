import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import { parseRivalHubDemoEvidenceV1 } from "../../../src/lib/demo-evidence/contract";
import type { RivalHubEvidenceSubmission } from "../../../src/lib/demo-integration/contracts";
import { buildEvidenceRevision } from "../../../src/lib/demo-integration/revision";
import { submitRivalHubEvidence } from "../../../src/lib/demo-integration/submit";
import { createLocalPool } from "./harness/database";

const fixturePath = resolve(process.cwd(), "tests/fixtures/demo-evidence/normal-map-v1.json");

describe("DAK evidence submit persistence", () => {
  it("promotes the same needs_attention artifact after an OCR conflict clears without duplicating projections", async () => {
    const pool = createLocalPool();
    const client = await pool.connect();
    const database = drizzle(client, { schema });
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
        { id: ids.rosterA, matchId: ids.match, entryId: ids.entryA, source: "admin_select", status: "confirmed", confirmedAt: now, confirmedBy: userIds[0]! },
        { id: ids.rosterB, matchId: ids.match, entryId: ids.entryB, source: "admin_select", status: "confirmed", confirmedAt: now, confirmedBy: userIds[5]! },
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
      await database.insert(schema.matchPlayerStats).values({
        id: ids.ocrStat,
        matchId: ids.match,
        mapId: ids.map,
        perfectName: "OCR display name",
        userId: userIds[0]!,
        kills: evidence.summaries.playerMaps[0]!.kills + 1,
      });
      await client.query("COMMIT");

      const first = await submitRivalHubEvidence({
        input: evidence,
        pairingId: ids.pairing,
        pairingScope: { seasonIds: [ids.season] },
        idempotencyKey: "dak-retry-evidence-1",
      });
      expect(first.status).toBe("needs_attention");
      expect(first.issues.some((row) => row.code === "OCR_CONFLICT")).toBe(true);
      const importId = first.importId;
      expect(importId).not.toBeNull();
      if (!importId) throw new Error("测试未创建 Demo import");

      await database.update(schema.matchPlayerStats).set({ kills: evidence.summaries.playerMaps[0]!.kills }).where(eq(schema.matchPlayerStats.id, ids.ocrStat));

      const second = await submitRivalHubEvidence({
        input: evidence,
        pairingId: ids.pairing,
        pairingScope: { seasonIds: [ids.season] },
        idempotencyKey: "dak-retry-evidence-1",
      });
      expect(second).toMatchObject({ status: "synced", importId, issues: [] });

      const importsAfterPromotion = await database.select().from(schema.matchDemoImports).where(eq(schema.matchDemoImports.matchMapId, ids.map));
      expect(importsAfterPromotion).toHaveLength(1);
      expect(importsAfterPromotion[0]).toMatchObject({ status: "confirmed", issues: [] });
      expect(importsAfterPromotion[0]?.confirmedAt).not.toBeNull();
      const factsAfterPromotion = await database.select().from(schema.matchRoundFacts).where(eq(schema.matchRoundFacts.importId, importId));
      expect(factsAfterPromotion).toHaveLength(evidence.sourceFacts.rounds.length);
      expect((await database.select().from(schema.matchPlayerStats).where(eq(schema.matchPlayerStats.id, ids.ocrStat)))[0]).toMatchObject({
        perfectName: "Fixture Player 01",
        dakImportId: importId,
      });

      const third = await submitRivalHubEvidence({
        input: evidence,
        pairingId: ids.pairing,
        pairingScope: { seasonIds: [ids.season] },
        idempotencyKey: "dak-retry-evidence-1",
      });
      expect(third).toMatchObject({ status: "synced", importId, issues: [] });
      expect(await database.select().from(schema.matchDemoImports).where(eq(schema.matchDemoImports.matchMapId, ids.map))).toHaveLength(1);
      expect(await database.select().from(schema.matchRoundFacts).where(eq(schema.matchRoundFacts.importId, importId))).toHaveLength(factsAfterPromotion.length);
      const autoConfirmAudits = await database.select().from(schema.auditLogs).where(and(
        eq(schema.auditLogs.action, "match.demo.auto_confirm"),
        eq(schema.auditLogs.targetId, importId),
      ));
      expect(autoConfirmAudits).toHaveLength(1);
      expect((autoConfirmAudits[0]?.meta as { retryPromotion?: boolean } | null)?.retryPromotion).toBe(true);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      await client.query("BEGIN").catch(() => {});
      await client.query("DELETE FROM match_round_facts WHERE import_id IN (SELECT id FROM match_demo_imports WHERE match_map_id = $1)", [ids.map]).catch(() => {});
      await client.query("DELETE FROM match_player_stats WHERE map_id = $1", [ids.map]).catch(() => {});
      await client.query("DELETE FROM match_demo_imports WHERE match_map_id = $1", [ids.map]).catch(() => {});
      await client.query("DELETE FROM audit_logs WHERE season_id = $1", [ids.season]).catch(() => {});
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
      await client.query("DELETE FROM competition_entries WHERE id IN ($1, $2)", [ids.entryA, ids.entryB]).catch(() => {});
      await client.query("DELETE FROM seasons WHERE id = $1", [ids.season]).catch(() => {});
      await client.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]).catch(() => {});
      await client.query("COMMIT").catch(() => {});
      client.release();
      await pool.end();
    }
  });
});
