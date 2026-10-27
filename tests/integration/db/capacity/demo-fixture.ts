// Adapted from the canonical Demo integration fixture; all values are synthetic.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import * as demoEvidenceContract from "@/lib/demo-evidence/contract";
import type { RivalHubEvidenceSubmission } from "@/lib/demo-integration/contracts";
import { buildEvidenceRevision, sha256Json } from "@/lib/demo-integration/revision";

export async function seedDemoCapacity(client: PoolClient, seed: number) {
  const database = drizzle(client, { schema });
  const fixturePath = resolve(process.cwd(), "tests/fixtures/demo-evidence/normal-map-v1.json");
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
    const steamFor = (index: number) => (BigInt("76561198000000000") + BigInt(seed * 100 + index + 1)).toString();
    const userIds = Array.from({ length: 10 }, () => randomUUID());
    const participantIds = userIds.map(() => randomUUID());
    const eventMemberIds = userIds.map(() => randomUUID());
    const rosterMemberIds = userIds.map(() => randomUUID());
    const now = new Date("2026-09-13T05:00:00.000Z");
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
    await client.query("BEGIN");
    try {
      await database.insert(schema.users).values(userIds.map((id, index) => ({
        id,
        email: `${id}@local.test`,
        steam64: steamFor(index),
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

      let fixtureJson = readFileSync(fixturePath, "utf8");
      for (let index = 0; index < 10; index++) fixtureJson = fixtureJson.replaceAll(`765611980000000${String(index + 1).padStart(2, "0")}`, steamFor(index));
      const fixture = demoEvidenceContract.parseRivalHubDemoEvidenceV1(JSON.parse(fixtureJson) as unknown);
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
          steam64: steamFor(index),
          isStarter: true,
        })),
      });
      const alternate = (BigInt("76561198900000000") + BigInt(seed)).toString();
      const aliasEvidence = demoEvidenceContract.parseRivalHubDemoEvidenceV1(JSON.parse(JSON.stringify(evidence).replaceAll(evidence.participants[0]!.steamId64, alternate)) as unknown);
      aliasEvidence.participants[0] = { ...aliasEvidence.participants[0]!, resolution: { status: "unresolved" } };
      const importId = randomUUID();
      await database.insert(schema.matchDemoImports).values({
        id: importId, seasonId: ids.season, matchId: ids.match, matchMapId: ids.map, stageKey: "fixture-stage", stageRunId: null,
        demoSha256: aliasEvidence.source.demoSha256, payloadSha256: sha256Json(aliasEvidence), contractVersion: aliasEvidence.contract.contractVersion,
        semanticProfile: aliasEvidence.contract.semanticProfile, analysisVersion: aliasEvidence.contract.analysisVersion,
        evidenceRevision: aliasEvidence.target.evidenceRevision, status: "needs_attention", payload: aliasEvidence,
        submittedByPairingId: ids.pairing, idempotencyKey: `capacity-demo-${seed}`, supersedesImportId: null,
        issues: [{ code: "PARTICIPANT_IDENTITY_UNRESOLVED", path: `participants.${alternate}`, message: "unresolved synthetic identity" }],
        submittedAt: now, confirmedAt: null, createdAt: now,
      });
      await client.query("COMMIT");
      return { seasonId: ids.season, importId, actorId: userIds[0]!, userId: userIds[0]!, eventRosterMemberId: eventMemberIds[0]!, alternate };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
}
