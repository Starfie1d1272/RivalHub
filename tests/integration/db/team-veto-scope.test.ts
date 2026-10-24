import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import type { DB } from "../../../src/db/client";
import { getLongTeamCareerDetail, getTournamentStats, getTournamentTeamDetail } from "../../../src/lib/stats/tournament-query";
import { getTeamMapProfiles } from "@/lib/teams/data";
import { requireCompetitionMatch } from "@/lib/matches/competition-context";
import { createLocalPool } from "./harness/database";

it("keeps a team's deciders and BP samples separate from unrelated matches in the same event", async () => {
  const pool = createLocalPool();
  const queries: string[] = [];
  const database = drizzle(pool, { schema, logger: { logQuery: query => queries.push(query) } });
  const rollback = new Error("rollback fixture");
  try {
    await expect(database.transaction(async tx => {
      await tx.execute(sql`SET CONSTRAINTS ALL DEFERRED`);
      const seasonId = randomUUID();
      const userId = randomUUID();
      const teamId = randomUUID();
      const entries = Array.from({ length: 4 }, () => ({ id: randomUUID(), revision: randomUUID() }));
      const [ownMatch, otherMatch] = [randomUUID(), randomUUID()];
      await tx.insert(schema.users).values({ id: userId, email: `${userId}@example.test`, displayName: "Veto scope fixture" });
      await tx.insert(schema.seasons).values({ id: seasonId, slug: seasonId, name: "Veto scope", kind: "custom", status: "finished" });
      await tx.insert(schema.teams).values({ id: teamId, slug: teamId, name: "Long Team", captainUserId: userId, creatorUserId: userId });
      await tx.insert(schema.competitionEntries).values(entries.map((entry, index) => ({ id: entry.id, competitionId: seasonId, source: index === 0 ? "linked_team" as const : "event_native" as const, teamId: index === 0 ? teamId : null, name: `Team ${index}`, representativeUserId: userId, registrationStatus: "approved" as const, currentRosterRevisionId: entry.revision })));
      await tx.insert(schema.competitionEntryRosterRevisions).values(entries.map(entry => ({ id: entry.revision, entryId: entry.id, revisionNumber: 1, status: "approved" as const, createdBy: "fixture" })));
      await tx.insert(schema.matches).values([ownMatch!, otherMatch!].map((id, index) => ({ id, seasonId, entryAId: entries[index * 2]!.id, entryBId: entries[index * 2 + 1]!.id, stage: "main", status: "finished" as const, format: "bo3" as const, scoreA: 2, scoreB: 0, completedAt: new Date() })));
      await tx.insert(schema.matchVetoSteps).values([
        { matchId: ownMatch!, stepOrder: 0, actionType: "ban", mapName: "de_nuke", entryId: entries[0]!.id },
        { matchId: ownMatch!, stepOrder: 1, actionType: "pick", mapName: "de_mirage", entryId: entries[0]!.id },
        { matchId: ownMatch!, stepOrder: 2, actionType: "decider", mapName: "de_ancient" },
        { matchId: otherMatch!, stepOrder: 0, actionType: "pick", mapName: "de_dust2", entryId: entries[2]!.id },
        { matchId: otherMatch!, stepOrder: 1, actionType: "decider", mapName: "de_ancient" },
      ]);
      await tx.insert(schema.matchMaps).values([
        { matchId: ownMatch!, mapOrder: 1, mapName: "de_mirage", scoreA: 13, scoreB: 8 },
        { matchId: otherMatch!, mapOrder: 1, mapName: "de_dust2", scoreA: 8, scoreB: 13 },
      ]);
      const matchRows = (await tx.select().from(schema.matches).where(sql`${schema.matches.seasonId} = ${seasonId}`)).map(requireCompetitionMatch);
      // Shared reads retain each opponent's own matches and action-specific denominator.
      const before = queries.length;
      const profiles = await getTeamMapProfiles(entries.map(entry => ({
        entryId: entry.id, matches: matchRows.filter(match => match.entryAId === entry.id || match.entryBId === entry.id),
      })), tx);
      expect(queries.slice(before).filter(query => query.startsWith("select"))).toHaveLength(2);
      expect(profiles[0]!.mapWins).toEqual(new Map([["de_mirage", { wins: 1, played: 1 }]]));
      expect(profiles[0]!.picks).toEqual({ count: new Map([["de_mirage", 1]]), bpMatchCount: 1 });
      expect(profiles[1]!.picks).toEqual({ count: new Map(), bpMatchCount: 1 });
      expect(profiles[2]!.bans).toEqual({ count: new Map(), bpMatchCount: 0 });
      expect(profiles[3]!.mapWins).toEqual(new Map([["de_dust2", { wins: 1, played: 1 }]]));
      const detail = await getTournamentTeamDetail({ seasonId, teamId: entries[0]!.id }, tx as unknown as DB);
      expect(detail.selection.find(row => row.mapName === "de_ancient")?.deciders).toBe(1);
      expect(detail.selection.find(row => row.mapName === "de_dust2")?.picks ?? 0).toBe(0);
      expect(detail.vetoActionSamples).toEqual({ pick: 1, ban: 1 });
      expect(detail.maps.find(row => row.mapName === "de_nuke")?.selection?.bans).toBe(1);
      const career = await getLongTeamCareerDetail(teamId, tx as unknown as DB);
      expect(career.vetoActionSamples).toEqual({ pick: 1, ban: 1 });
      expect(career.maps.find(row => row.mapName === "de_nuke")?.selection?.bans).toBe(1);
      expect(career.maps.find(row => row.mapName === "de_mirage")?.selection?.picks).toBe(1);
      expect(career.maps.some(row => row.mapName === "de_dust2")).toBe(false);
      const event = await getTournamentStats({ seasonId }, tx as unknown as DB);
      expect(event.selection.find(row => row.mapName === "de_ancient")?.deciders).toBe(2);
      throw rollback;
    })).rejects.toBe(rollback);
  } finally { await pool.end(); }
});
