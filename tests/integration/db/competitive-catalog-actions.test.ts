import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { deleteCompetitivePlatformRank, deleteCompetitivePlatformSeason, moveCompetitivePlatformRank, moveCompetitivePlatformSeason, setCompetitivePlatformSeasonActive, setCurrentCompetitivePlatformSeason, updateCompetitivePlatformRankLabel, updateCompetitivePlatformSeason } from "@/actions/competitive-platform";
import { ErrorCode } from "@/lib/errors";
import { createLocalPool } from "./harness/database";

const { requireSuperAdminMock } = vi.hoisted(() => ({ requireSuperAdminMock: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  requireSuperAdmin: requireSuperAdminMock,
  auditActorId: (session: { userId: string }) => session.userId,
}));

async function withCatalog(work: (fixture: { pool: ReturnType<typeof createLocalPool>; platform: string; source: string; userId: string; eventId: string; first: string; second: string; rankFirst: string; rankSecond: string }) => Promise<void>) {
  const pool = createLocalPool({ max: 2 });
  const userId = randomUUID(), eventId = randomUUID();
  const platform = `catalog-${userId}`, source = `source-${userId}`;
  const first = randomUUID(), second = randomUUID(), rankFirst = randomUUID(), rankSecond = randomUUID();
  requireSuperAdminMock.mockResolvedValue({ userId });
  try {
    await pool.query("INSERT INTO users(id,email) VALUES($1,$2)", [userId, `${userId}@local.test`]);
    await pool.query("INSERT INTO competitive_platforms(key,display_name,rating_label) VALUES($1,'Primary','Rating'),($2,'Source','Rating+')", [platform, source]);
    await pool.query("INSERT INTO competitive_platform_seasons(id,platform,season_key,label,sort_order) VALUES($1,$3,'first','First',1),($2,$3,'second','Second',2)", [first, second, source]);
    await pool.query("INSERT INTO competitive_platform_ranks(id,platform_key,rank_key,label,sort_order) VALUES($1,$3,'first','First',1),($2,$3,'second','Second',2)", [rankFirst, rankSecond, source]);
    await pool.query("INSERT INTO competitive_platform_seasons(platform,season_key,label,sort_order) VALUES($1,'negative-2','Reserved',-2),($1,'negative-1','Reserved',-1)", [source]);
    await pool.query("INSERT INTO competitive_platform_ranks(platform_key,rank_key,label,sort_order) VALUES($1,'negative-2','Reserved',-2),($1,'negative-1','Reserved',-1)", [source]);
    await work({ pool, platform, source, userId, eventId, first, second, rankFirst, rankSecond });
  } finally {
    await pool.query("DELETE FROM audit_logs WHERE actor_id=$1", [userId]);
    await pool.query("DELETE FROM seasons WHERE id=$1", [eventId]);
    await pool.query("DELETE FROM users WHERE id=$1", [userId]);
    await pool.query("DELETE FROM competitive_platform_seasons WHERE platform=ANY($1::text[])", [[platform, source]]);
    await pool.query("DELETE FROM competitive_platform_ranks WHERE platform_key=ANY($1::text[])", [[platform, source]]);
    await pool.query("DELETE FROM competitive_platforms WHERE key=ANY($1::text[])", [[platform, source]]);
    await pool.end();
  }
}

describe("competitive catalog actions against PostgreSQL", () => {
  it("swaps unique orders and current pointers while preserving identity and atomic audit", async () => {
    await withCatalog(async ({ pool, source, userId, first, second, rankFirst, rankSecond }) => {
      await expect(moveCompetitivePlatformSeason({ id: second, direction: "earlier" })).resolves.toMatchObject({ success: true });
      await expect(moveCompetitivePlatformRank({ id: rankSecond, direction: "up" })).resolves.toMatchObject({ success: true });
      await expect(updateCompetitivePlatformSeason({ id: first, label: "Renamed" })).resolves.toMatchObject({ success: true });
      await expect(updateCompetitivePlatformRankLabel({ id: rankFirst, label: "Renamed" })).resolves.toMatchObject({ success: true });
      expect((await pool.query("SELECT season_key,sort_order,label FROM competitive_platform_seasons WHERE platform=$1 AND id=ANY($2::uuid[]) ORDER BY sort_order", [source, [first, second]])).rows).toEqual([
        { season_key: "second", sort_order: 1, label: "Second" }, { season_key: "first", sort_order: 2, label: "Renamed" },
      ]);
      expect((await pool.query("SELECT rank_key,sort_order,label FROM competitive_platform_ranks WHERE platform_key=$1 AND id=ANY($2::uuid[]) ORDER BY sort_order", [source, [rankFirst, rankSecond]])).rows).toEqual([
        { rank_key: "second", sort_order: 1, label: "Second" }, { rank_key: "first", sort_order: 2, label: "Renamed" },
      ]);
      await expect(setCurrentCompetitivePlatformSeason({ id: first })).resolves.toMatchObject({ success: true });
      await expect(setCurrentCompetitivePlatformSeason({ id: second })).resolves.toMatchObject({ success: true });
      expect((await pool.query("SELECT id FROM competitive_platform_seasons WHERE platform=$1 AND is_current", [source])).rows).toEqual([{ id: second }]);
      expect((await pool.query("SELECT count(*)::int AS count FROM audit_logs WHERE actor_id=$1", [userId])).rows).toEqual([{ count: 6 }]);

      await expect(deleteCompetitivePlatformSeason({ id: second })).resolves.toMatchObject({ success: false, error: { code: ErrorCode.VALIDATION_FAILED } });
      await expect(setCompetitivePlatformSeasonActive({ id: second, active: false })).resolves.toMatchObject({ success: false, error: { code: ErrorCode.VALIDATION_FAILED } });
      await pool.query("UPDATE competitive_platform_seasons SET active=false WHERE id=$1", [first]);
      await expect(setCurrentCompetitivePlatformSeason({ id: first })).resolves.toMatchObject({ success: false, error: { code: ErrorCode.VALIDATION_FAILED } });
      await pool.query("INSERT INTO competitive_rank_facts(user_id,platform,kind,rank,rating) VALUES($1,$2,'historical_peak','first',1)", [userId, source]);
      await expect(moveCompetitivePlatformRank({ id: rankFirst, direction: "up" })).resolves.toMatchObject({ success: false, error: { code: ErrorCode.VALIDATION_FAILED } });
      await expect(deleteCompetitivePlatformRank({ id: rankFirst })).resolves.toMatchObject({ success: false, error: { code: ErrorCode.VALIDATION_FAILED } });
      await expect(deleteCompetitivePlatformRank({ id: rankSecond })).resolves.toMatchObject({ success: true });
      expect((await pool.query("SELECT id FROM competitive_platform_ranks WHERE id=ANY($1::uuid[])", [[rankFirst, rankSecond]])).rows).toEqual([{ id: rankFirst }]);

      // A database-side audit failure must roll back the preceding mutation.
      requireSuperAdminMock.mockResolvedValue({ userId: `${userId}\0` });
      await expect(updateCompetitivePlatformSeason({ id: first, label: "Must roll back" })).resolves.toMatchObject({ success: false, error: { code: ErrorCode.INTERNAL_ERROR } });
      expect((await pool.query("SELECT label FROM competitive_platform_seasons WHERE id=$1", [first])).rows).toEqual([{ label: "Renamed" }]);
      expect((await pool.query("SELECT count(*)::int AS count FROM audit_logs WHERE actor_id=$1", [userId])).rows).toEqual([{ count: 7 }]);
    });
  });

  it("blocks actual deletion for provenance and every frozen season reference, including a different primary platform", async () => {
    await withCatalog(async ({ pool, platform, source, userId, eventId, first, second }) => {
      await pool.query("INSERT INTO competitive_rank_facts(user_id,platform,kind,rank,rating,achieved_season_key) VALUES($1,$2,'historical_peak','first',1,'first')", [userId, source]);
      await expect(deleteCompetitivePlatformSeason({ id: first })).resolves.toMatchObject({ success: false, error: { code: ErrorCode.VALIDATION_FAILED } });
      await pool.query("DELETE FROM competitive_rank_facts WHERE user_id=$1", [userId]);
      await pool.query("INSERT INTO seasons(id,slug,name,kind,status,team_registration_config) VALUES($1,$2,'Frozen','Major','registration','{}')", [eventId, `frozen-${eventId}`]);
      for (const competitiveProfile of [
        { platform: source, currentSeasonKey: "first" },
        { platform: source, previousSeasonKey: "first" },
        { platform: source, evidencePolicy: { referenceSeasonKey: "first" } },
        { platform: source, evidencePolicy: { recentSeasonKeys: ["first"] } },
        { platform, fallbackConversion: { sourcePlatform: source, seasonKeyMap: { primary: "first" } } },
      ]) {
        await pool.query("UPDATE seasons SET team_registration_config=$2::json WHERE id=$1", [eventId, JSON.stringify({ competitiveProfile })]);
        await expect(deleteCompetitivePlatformSeason({ id: first }), JSON.stringify(competitiveProfile)).resolves.toMatchObject({ success: false, error: { code: ErrorCode.VALIDATION_FAILED } });
        expect((await pool.query("SELECT id FROM competitive_platform_seasons WHERE id=$1", [first])).rows).toEqual([{ id: first }]);
      }
      expect((await pool.query("SELECT count(*)::int AS count FROM audit_logs WHERE actor_id=$1", [userId])).rows).toEqual([{ count: 0 }]);
      await expect(deleteCompetitivePlatformSeason({ id: second })).resolves.toMatchObject({ success: true });
      expect((await pool.query("SELECT id FROM competitive_platform_seasons WHERE id=$1", [second])).rows).toEqual([]);
      expect((await pool.query("SELECT action,target_id FROM audit_logs WHERE actor_id=$1", [userId])).rows).toEqual([{ action: "competitive_platform_season.delete", target_id: second }]);
    });
  });
});
