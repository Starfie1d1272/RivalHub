import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import { saveCompetitiveProfileInTx } from "../../../src/lib/competitive/save-profile";
import { inspectCompetitiveProfileRepair, repairCompetitiveProfileMissingRows } from "../../../src/lib/competitive/profile-repair";
import { createLocalPool } from "./harness/database";

describe("competitive profile transactional normalization", () => {
  it.each(["perfect_world", "fivee"])("write-through, conflict, promotion, repair and rollback on %s", async platform => {
    const pool = createLocalPool();
    const database = drizzle(pool, { schema });
    const userId = randomUUID();
    const prefix = `peak-${userId}`;
    const s1 = `${prefix}-1`, s2 = `${prefix}-2`;
    const rank = platform === "fivee" ? "SS" : "黄金S";
    const stars = platform === "fivee" ? 23 : 17;
    const peak = { status: "ranked" as const, rank, stars, rating: 1.14, achievedSeasonKey: s1 };
    const save = (historicalPeak = peak, seasonPeaks: Parameters<typeof saveCompetitiveProfileInTx>[1]["seasonPeaks"] = []) => database.transaction(tx => saveCompetitiveProfileInTx(tx, { userId, actorId: userId, platform, historicalPeak, seasonPeaks }));
    try {
      await pool.query("INSERT INTO users(id,email) VALUES($1,$2)", [userId, `${prefix}@local.test`]);
      const maxOrder = Number((await pool.query("SELECT coalesce(max(sort_order),0) AS n FROM competitive_platform_seasons WHERE platform=$1", [platform])).rows[0].n);
      await pool.query("INSERT INTO competitive_platform_seasons(platform,season_key,label,sort_order) VALUES($1,$2,$2,$4),($1,$3,$3,$5)", [platform,s1,s2,maxOrder+1,maxOrder+2]);
      await save();
      const facts = () => pool.query("SELECT kind,rank,stars,rating,achieved_season_key FROM competitive_rank_facts WHERE user_id=$1 ORDER BY kind", [userId]);
      expect((await facts()).rows).toHaveLength(2);
      expect((await facts()).rows.every(row => row.rank === rank && row.stars === stars && row.rating === "1.14")).toBe(true);
      for (const conflict of [{ seasonKey: s1, status: "ranked" as const, rank: "A", stars: null, rating: 1.14 }, { seasonKey: s1, status: "ranked" as const, rank, stars: stars+1, rating: 1.14 }, { seasonKey: s1, status: "ranked" as const, rank, stars, rating: 1.15 }, { seasonKey: s1, status: "unranked" as const, rating: null }]) {
        await expect(save(peak,[conflict])).rejects.toThrow(/记录为/);
        expect((await facts()).rows.every(row => row.rating === "1.14")).toBe(true);
      }
      await expect(save({ ...peak, stars: 999 }, [])).rejects.toThrow(/星数必须/);
      const promoted = await save(peak, [{ seasonKey:s2, status:"ranked",rank,stars:stars+1,rating:0.9 }]);
      expect(promoted.historicalPeak).toMatchObject({ achievedSeasonKey:s2,stars:stars+1,rating:0.9 });
      // An artificial failure after the owner runs must roll back facts and audit together.
      const before = (await facts()).rows;
      await expect(database.transaction(async tx => { await saveCompetitiveProfileInTx(tx, { userId, actorId:userId, platform, historicalPeak:{...peak,achievedSeasonKey:null},seasonPeaks:[] }); throw new Error("forced rollback"); })).rejects.toThrow("forced rollback");
      expect((await facts()).rows).toEqual(before);
      await pool.query("DELETE FROM competitive_rank_facts WHERE user_id=$1 AND kind='season_peak' AND platform_season_key=$2",[userId,s2]);
      expect((await database.transaction(tx => inspectCompetitiveProfileRepair(tx,userId))).missing).toBe(1);
      await expect(database.transaction(async tx => { await repairCompetitiveProfileMissingRows(tx, userId); throw new Error("repair rollback"); })).rejects.toThrow("repair rollback");
      expect((await database.transaction(tx => inspectCompetitiveProfileRepair(tx, userId))).missing).toBe(1);
      const historicalBefore = (await pool.query("SELECT * FROM competitive_rank_facts WHERE user_id=$1 AND kind='historical_peak'", [userId])).rows;
      const attempts = await Promise.all([database.transaction(tx => repairCompetitiveProfileMissingRows(tx,userId)), database.transaction(tx => repairCompetitiveProfileMissingRows(tx,userId))]);
      expect(attempts.reduce((sum, report) => sum + report.repaired, 0)).toBe(1);
      expect((await database.transaction(tx => inspectCompetitiveProfileRepair(tx,userId))).missing).toBe(0);
      expect((await pool.query("SELECT * FROM competitive_rank_facts WHERE user_id=$1 AND kind='historical_peak'", [userId])).rows).toEqual(historicalBefore);
      expect((await database.transaction(tx => repairCompetitiveProfileMissingRows(tx,userId))).repaired).toBe(0);
      await pool.query("UPDATE competitive_rank_facts SET stars=$2 WHERE user_id=$1 AND kind='season_peak' AND platform_season_key=$3",[userId,stars,s2]);
      expect((await database.transaction(tx => repairCompetitiveProfileMissingRows(tx,userId)))).toMatchObject({ repaired:0, conflicts:1 });
      expect((await pool.query("SELECT count(*) AS n FROM audit_logs WHERE target_id=$1 AND action='competitive_profile.repair_missing_season'",[userId])).rows[0].n).toBe("1");
    } finally {
      await pool.query("DELETE FROM audit_logs WHERE target_id=$1",[userId]);
      await pool.query("DELETE FROM users WHERE id=$1",[userId]);
      await pool.query("DELETE FROM competitive_platform_seasons WHERE platform=$1 AND season_key=ANY($2::text[])",[platform,[s1,s2]]);
      await pool.end();
    }
  });
});
