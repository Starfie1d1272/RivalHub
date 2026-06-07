import { pgTable, uuid, integer, real, text, timestamp, unique } from "drizzle-orm/pg-core";
import { matches } from "./matches";
import { matchMaps } from "./match-maps";
import { users } from "./users";

export const matchPlayerStats = pgTable("match_player_stats", {
  id: uuid("id").primaryKey().defaultRandom(),
  matchId: uuid("match_id").notNull().references(() => matches.id),
  mapId: uuid("map_id").notNull().references(() => matchMaps.id),

  // 记分板上的完美昵称（原始值，用于审核和兜底显示）
  perfectName: text("perfect_name").notNull(),
  // 映射到系统用户（可为 null：未匹配或手动留空）
  userId: uuid("user_id").references(() => users.id),

  // 统计数据（整数类）
  kills: integer("kills"),
  deaths: integer("deaths"),
  assists: integer("assists"),
  hsPercent: integer("hs_percent"),   // 0–100
  firstKills: integer("first_kills"),
  multiKills: integer("multi_kills"),
  clutches: integer("clutches"),

  // 统计数据（小数类）
  adr: real("adr"),           // ≥ 0
  rws: real("rws"),           // 两位小数
  ratingPro: real("rating_pro"), // 两位小数
  we: real("we"),             // 一位小数，0–16

  // 审核信息
  verifiedByAdmin: text("verified_by_admin"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqueMapPlayer: unique().on(t.mapId, t.perfectName),
}));

export type MatchPlayerStat = typeof matchPlayerStats.$inferSelect;
export type NewMatchPlayerStat = typeof matchPlayerStats.$inferInsert;
