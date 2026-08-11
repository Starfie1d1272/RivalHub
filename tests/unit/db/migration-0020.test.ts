import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const MIGRATIONS_DIR = join(process.cwd(), "drizzle/migrations");

const sql = readFileSync(join(MIGRATIONS_DIR, "0020_black_marvex.sql"), "utf-8");
const snap0020 = JSON.parse(
  readFileSync(join(MIGRATIONS_DIR, "meta/0020_snapshot.json"), "utf-8"),
) as { id: string; prevId: string; tables: Record<string, { columns: Record<string, { notNull: boolean }> }> };
const snap0019 = JSON.parse(
  readFileSync(join(MIGRATIONS_DIR, "meta/0019_snapshot.json"), "utf-8"),
) as { id: string };
const journal = JSON.parse(
  readFileSync(join(MIGRATIONS_DIR, "meta/_journal.json"), "utf-8"),
) as { entries: { idx: number; tag: string }[] };

describe("0020 canonical team identity migration — fail-closed coverage", () => {
  it("adds canonical columns nullable first（存量行安全）", () => {
    expect(sql).toContain('ADD COLUMN "season_id" uuid;');
    expect(sql).toContain('ADD COLUMN "user_id" uuid;');
    expect(sql).toContain('ADD COLUMN "captain_user_id" uuid;');
    // 初始 ADD 不得直接 NOT NULL，否则已有 rows 的表必然失败
    expect(sql.match(/ADD COLUMN "[^"]+" uuid NOT NULL/g)).toBeNull();
  });

  it("backfill 顺序正确：teams.captain_user_id ← season_registrations.user_id", () => {
    const idx = sql.indexOf('UPDATE "teams"');
    expect(idx).toBeGreaterThan(-1);
    expect(sql.slice(idx, idx + 400)).toContain("captain_registration_id");
    expect(sql.slice(idx, idx + 400)).toContain("season_registrations");
  });

  it("backfill team_members.user_id ← season_registrations.user_id", () => {
    const idx = sql.indexOf('UPDATE "team_members"');
    expect(idx).toBeGreaterThan(-1);
    expect(sql.slice(idx, idx + 400)).toContain("registration_id");
    expect(sql.slice(idx, idx + 400)).toContain("season_registrations");
  });

  it("backfill team_members.season_id ← teams.season_id", () => {
    const idx = sql.indexOf('SET "season_id" = t."season_id"');
    expect(idx).toBeGreaterThan(-1);
  });

  it("fail-closed validation：5 类异常全部 RAISE EXCEPTION", () => {
    const checks = [
      "teams.captain_user_id has NULL rows",
      "team_members.user_id has NULL rows",
      "team_members.season_id has NULL rows",
      "duplicate team_members(season_id, user_id)",
      "team_members.season_id does not match parent teams.season_id",
    ];
    for (const c of checks) {
      expect(sql).toContain(`RAISE EXCEPTION '${c}`);
    }
  });

  it("禁止自动删除/猜测/静默忽略（无 DELETE 兜底）", () => {
    expect(sql).not.toMatch(/DELETE FROM/i);
  });

  it("validation 通过后才 SET NOT NULL，且顺序在 backfill 之后", () => {
    const backfillPos = sql.indexOf('SET "season_id" = t."season_id"');
    const validatePos = sql.indexOf("RAISE EXCEPTION");
    const notNullPos = sql.indexOf('SET NOT NULL');
    expect(backfillPos).toBeGreaterThan(-1);
    expect(validatePos).toBeGreaterThan(backfillPos);
    expect(notNullPos).toBeGreaterThan(validatePos);
  });

  it("最终 NOT NULL + UNIQUE(season_id, user_id) + composite FK + teams(id, season_id) unique", () => {
    expect(sql).toContain('ALTER TABLE "teams" ALTER COLUMN "captain_user_id" SET NOT NULL');
    expect(sql).toContain('ALTER TABLE "team_members" ALTER COLUMN "user_id" SET NOT NULL');
    expect(sql).toContain('ALTER TABLE "team_members" ALTER COLUMN "season_id" SET NOT NULL');
    expect(sql).toContain('"team_members_season_id_user_id_unique" UNIQUE("season_id","user_id")');
    expect(sql).toContain('"team_members_team_season_fk"');
    expect(sql).toContain('"teams_id_season_id_unique" UNIQUE("id","season_id")');
  });

  it("provenance 列保持 NOT NULL（Rivals registration provenance 未放宽）", () => {
    const teamsCols = snap0020.tables["public.teams"].columns;
    const membersCols = snap0020.tables["public.team_members"].columns;
    expect(teamsCols["captain_registration_id"].notNull).toBe(true);
    expect(teamsCols["draft_order"].notNull).toBe(true);
    expect(membersCols["registration_id"].notNull).toBe(true);
  });

  it("snapshot 链：0020.prevId == 0019.id，journal 最后 idx 20，无 0021", () => {
    expect(snap0020.prevId).toBe(snap0019.id);
    expect(journal.entries[journal.entries.length - 1]).toMatchObject({ idx: 20, tag: "0020_black_marvex" });
    expect(journal.entries.some((e) => e.idx === 21)).toBe(false);
  });
});
