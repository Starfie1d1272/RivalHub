import { pgTable, uuid, numeric, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { seasons } from "./seasons";
import { users } from "./users";

export const playerRatings = pgTable("player_ratings", {
  id: uuid("id").primaryKey().defaultRandom(),
  seasonId: uuid("season_id").notNull().references(() => seasons.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id),
  steamId64: text("steam_id_64").notNull(),
  // RR 标量
  rrScore: numeric("rr_score", { precision: 8, scale: 4 }),
  rrWeightsVersion: text("rr_weights_version"),
  // PRISM 八维（百分位 0–100）
  prismFirepower: numeric("prism_firepower", { precision: 6, scale: 2 }),
  prismOpening:   numeric("prism_opening",   { precision: 6, scale: 2 }),
  prismClutch:    numeric("prism_clutch",    { precision: 6, scale: 2 }),
  prismSniping:   numeric("prism_sniping",   { precision: 6, scale: 2 }),
  prismSurvival:  numeric("prism_survival",  { precision: 6, scale: 2 }),
  prismUtility:   numeric("prism_utility",   { precision: 6, scale: 2 }),
  prismTrading:   numeric("prism_trading",   { precision: 6, scale: 2 }),
  prismEntry:     numeric("prism_entry",     { precision: 6, scale: 2 }),
  prismWeightsVersion: text("prism_weights_version"),
  // 样本量
  mapCount: integer("map_count").notNull().default(0),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // 每个赛季每名选手只有一行，重算时 upsert
  uniqueIndex("player_ratings_season_steam_uniq").on(t.seasonId, t.steamId64),
]);

export type PlayerRating = typeof playerRatings.$inferSelect;
export type NewPlayerRating = typeof playerRatings.$inferInsert;
