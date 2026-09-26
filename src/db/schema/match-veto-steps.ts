import { pgTable, uuid, integer, text, timestamp, unique, pgEnum, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { matches } from "./matches";
import { competitionEntries } from "./competition-entries";
import { sideEnum } from "./match-maps";
import { users } from "./users";

export const matchVetoStepSourceEnum = pgEnum("match_veto_step_source", ["participant", "admin", "timeout", "system"]);

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
    entryId: uuid("entry_id").references(() => competitionEntries.id),
    side: sideEnum("side"),
    /** Null only for legacy backfilled records created before online rooms. */
    source: matchVetoStepSourceEnum("source"),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    clientRequestId: text("client_request_id"),
    /** Logical BO turn, used for timeout reconciliation and audited rewind. */
    turnKey: text("turn_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueStep: unique().on(t.matchId, t.stepOrder),
    requestIdShape: check(
      "match_veto_steps_source_actor_shape_check",
      sql`${t.source} IS NULL
        OR (${t.source} IN ('participant', 'admin') AND ${t.actorUserId} IS NOT NULL)
        OR (${t.source} IN ('timeout', 'system') AND ${t.actorUserId} IS NULL)`,
    ),
    uniqueClientRequest: uniqueIndex("match_veto_steps_match_client_request_unique")
      .on(t.matchId, t.clientRequestId)
      .where(sql`${t.clientRequestId} IS NOT NULL`),
  }),
);
