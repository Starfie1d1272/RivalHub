import { pgTable, uuid, integer, text, unique } from "drizzle-orm/pg-core";
import { seasons } from "./seasons";
import { teams } from "./teams";

/**
 * 瑞士轮实时计分表
 * 每个 (season, stage, team) 一行，逐轮更新
 */
export const swissStandings = pgTable(
  "swiss_standings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id),
    stage: text("stage").notNull(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id),
    seed: integer("seed").notNull(),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    buScore: integer("bu_score").notNull().default(0),
    status: text("status").notNull().default("active"),
  },
  (t) => ({
    uniqueStanding: unique().on(t.seasonId, t.stage, t.teamId),
  }),
);

export type SwissStanding = typeof swissStandings.$inferSelect;
export type NewSwissStanding = typeof swissStandings.$inferInsert;
export type SwissStatus = "active" | "advanced" | "eliminated";
