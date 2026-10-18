import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import type { DB } from "../../../src/db/client";
import { getTournamentStats, getTournamentTeamDetail } from "../../../src/lib/stats/tournament-query";
import { createLocalPool } from "./harness/database";

it("keeps a team's deciders and BP samples separate from unrelated matches in the same event", async () => {
  const pool = createLocalPool();
  const database = drizzle(pool, { schema });
  const rollback = new Error("rollback fixture");
  try {
    await expect(database.transaction(async tx => {
      await tx.execute(sql`SET CONSTRAINTS ALL DEFERRED`);
      const seasonId = randomUUID();
      const userId = randomUUID();
      const entries = Array.from({ length: 4 }, () => ({ id: randomUUID(), revision: randomUUID() }));
      const [ownMatch, otherMatch] = [randomUUID(), randomUUID()];
      await tx.insert(schema.users).values({ id: userId, email: `${userId}@example.test`, displayName: "Veto scope fixture" });
      await tx.insert(schema.seasons).values({ id: seasonId, slug: seasonId, name: "Veto scope", kind: "custom", status: "finished" });
      await tx.insert(schema.competitionEntries).values(entries.map((entry, index) => ({ id: entry.id, competitionId: seasonId, source: "event_native" as const, name: `Team ${index}`, representativeUserId: userId, registrationStatus: "approved" as const, currentRosterRevisionId: entry.revision })));
      await tx.insert(schema.competitionEntryRosterRevisions).values(entries.map(entry => ({ id: entry.revision, entryId: entry.id, revisionNumber: 1, status: "approved" as const, createdBy: "fixture" })));
      await tx.insert(schema.matches).values([ownMatch!, otherMatch!].map((id, index) => ({ id, seasonId, entryAId: entries[index * 2]!.id, entryBId: entries[index * 2 + 1]!.id, stage: "main", status: "finished" as const, format: "bo3" as const, scoreA: 2, scoreB: 0, completedAt: new Date() })));
      await tx.insert(schema.matchVetoSteps).values([
        { matchId: ownMatch!, stepOrder: 0, actionType: "ban", mapName: "de_nuke", entryId: entries[0]!.id },
        { matchId: ownMatch!, stepOrder: 1, actionType: "pick", mapName: "de_mirage", entryId: entries[0]!.id },
        { matchId: ownMatch!, stepOrder: 2, actionType: "decider", mapName: "de_ancient" },
        { matchId: otherMatch!, stepOrder: 0, actionType: "pick", mapName: "de_dust2", entryId: entries[2]!.id },
        { matchId: otherMatch!, stepOrder: 1, actionType: "decider", mapName: "de_ancient" },
      ]);
      const detail = await getTournamentTeamDetail({ seasonId, teamId: entries[0]!.id }, tx as unknown as DB);
      expect(detail.selection.find(row => row.mapName === "de_ancient")?.deciders).toBe(1);
      expect(detail.selection.find(row => row.mapName === "de_dust2")?.picks ?? 0).toBe(0);
      expect(detail.vetoActionSamples).toEqual({ pick: 1, ban: 1 });
      expect(detail.maps.find(row => row.mapName === "de_nuke")?.selection?.bans).toBe(1);
      const event = await getTournamentStats({ seasonId }, tx as unknown as DB);
      expect(event.selection.find(row => row.mapName === "de_ancient")?.deciders).toBe(2);
      throw rollback;
    })).rejects.toBe(rollback);
  } finally { await pool.end(); }
});
