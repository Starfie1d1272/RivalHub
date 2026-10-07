import { loadUnassociatedMizarDocumentInTx } from "../../../src/lib/mizar/context";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import { localDatabaseUrl } from "./harness/database";
import { createUnassociatedMatchInTx } from "../../../src/lib/matches/creation";
import { applyMatchStatusTransitionInTx } from "../../../src/lib/matches/lifecycle";
import { concludeUnassociatedMatchInTx } from "../../../src/lib/matches/unassociated-result";
import { recordCanonicalMapResultInTx } from "../../../src/lib/matches/results";

const input = { sides: { a: { name: "临时 A", logoUrl: null }, b: { name: "临时 B", logoUrl: null } }, format: "bo1", mapPool: ["de_mirage"], scheduledAt: null };

describe("independent match execution persistence", () => {
  it("creates, starts and finishes without an event, teams, roster, BP or telemetry", async () => {
    const pool = new Pool({ connectionString: localDatabaseUrl() });
    const database = drizzle(pool, { schema });
    try {
      await expect(database.transaction(tx => createUnassociatedMatchInTx(tx, { ...input, format: "bo3" }, "execution-test"))).rejects.toThrow("地图池不足");
      const match = await database.transaction(tx => createUnassociatedMatchInTx(tx, input, "execution-test"));
      expect(match.seasonId).toBeNull();
      expect(match.entryAId).toBeNull();
      const document = await database.transaction(tx => loadUnassociatedMizarDocumentInTx(tx, match.id));
      expect(document.schemaVersion).toBe("rivalhub.broadcast-manifest.v2");
      expect(document.match.competition).toBeNull();
      expect(document.entrants.a).toMatchObject({ name: "临时 A", roster: { players: [] } });
      const start = await database.transaction(tx => applyMatchStatusTransitionInTx(tx, { matchId: match.id, nextStatus: "in_progress", actorId: "execution-test" }));
      expect(start.lineups).toBeNull();
      await database.transaction(tx => concludeUnassociatedMatchInTx(tx, { matchId: match.id, actorId: "execution-test", conclusion: { kind: "omitted" } }));
      const [finished] = await database.select().from(schema.matches).where(eq(schema.matches.id, match.id));
      expect(finished).toMatchObject({ status: "finished", scoreA: null, scoreB: null, resultDisposition: "omitted", isForfeit: false });
      expect(await database.select().from(schema.matchMaps).where(eq(schema.matchMaps.matchId, match.id))).toEqual([]);
      expect(await database.select().from(schema.matchRosters).where(eq(schema.matchRosters.matchId, match.id))).toEqual([]);
    } finally { await pool.end(); }
  });
  it("records an actual map result without requiring declared players or online BP", async () => {
    const pool = new Pool({ connectionString: localDatabaseUrl() });
    const database = drizzle(pool, { schema });
    try {
      const match = await database.transaction(tx => createUnassociatedMatchInTx(tx, input, "execution-test"));
      await database.transaction(tx => applyMatchStatusTransitionInTx(tx, { matchId: match.id, nextStatus: "in_progress", actorId: "execution-test" }));
      await database.transaction(tx => recordCanonicalMapResultInTx(tx, { matchId: match.id, mapOrder: 1, mapName: "de_mirage", scoreA: 13, scoreB: 7, pickedByEntryId: null, teamAStartSide: null, actorId: "execution-test" }));
      const [finished] = await database.select().from(schema.matches).where(eq(schema.matches.id, match.id));
      expect(finished).toMatchObject({ status: "finished", scoreA: 1, scoreB: 0, resultDisposition: "recorded" });
    } finally { await pool.end(); }
  });
});
