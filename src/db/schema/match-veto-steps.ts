import { pgTable, uuid, integer, text, timestamp, unique } from "drizzle-orm/pg-core";
import { matches } from "./matches";
import { teams } from "./teams";
import { sideEnum } from "./match-maps";

/**
 * BP 选图步骤记录
 *
 * BO1：ban×4, ban×2 → decider（1 步；B 选边）
 * BO3：ban×2 + pick×2 + ban×2 → decider（7 步）
 * BO5：ban×2 + pick×4 → decider（7 步；刀赛）
 *
 * 由管理员在 VetoInputDialog 中录入，VetoView 以 HLTV 纵向列表展示。
 */
export const matchVetoSteps = pgTable(
  "match_veto_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matchId: uuid("match_id").notNull().references(() => matches.id),
    stepOrder: integer("step_order").notNull(),
    actionType: text("action_type").notNull(),
    mapName: text("map_name").notNull(),
    teamId: uuid("team_id").references(() => teams.id),
    side: sideEnum("side"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueStep: unique().on(t.matchId, t.stepOrder),
  }),
);
