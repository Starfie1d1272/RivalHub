import { sql } from "drizzle-orm";
import { check, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { cs2RoleEnum } from "./competitive-profile";
import { seasons } from "./seasons";
import { teams } from "./teams";
import { users } from "./users";

export const recruitmentIntentKindEnum = pgEnum("recruitment_intent_kind", ["team_recruiting", "player_lft"]);
export const recruitmentIntentStatusEnum = pgEnum("recruitment_intent_status", ["open", "closed"]);

/**
 * A current discovery intent. It deliberately does not model membership,
 * applications, messaging, or a long-lived player profile.
 */
export const recruitmentIntents = pgTable("recruitment_intents", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: recruitmentIntentKindEnum("kind").notNull(),
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  positions: cs2RoleEnum("positions").array().notNull().default(sql`ARRAY[]::cs2_role[]`),
  targetSeasonId: uuid("target_season_id").references(() => seasons.id, { onDelete: "set null" }),
  note: text("note"),
  status: recruitmentIntentStatusEnum("status").notNull().default("open"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  oneTeamIntent: uniqueIndex("recruitment_intents_one_team_unique").on(t.teamId),
  oneUserIntent: uniqueIndex("recruitment_intents_one_user_unique").on(t.userId),
  openDiscoveryIndex: index("recruitment_intents_open_discovery_idx").on(t.kind, t.status, t.expiresAt, t.updatedAt),
  targetSeasonIndex: index("recruitment_intents_target_season_idx").on(t.targetSeasonId),
  ownerShape: check(
    "recruitment_intents_owner_shape_check",
    sql`(${t.kind} = 'team_recruiting' AND ${t.teamId} IS NOT NULL AND ${t.userId} IS NULL)
      OR (${t.kind} = 'player_lft' AND ${t.userId} IS NOT NULL AND ${t.teamId} IS NULL)`,
  ),
}));

/** A player asking a recruiting Team to review their public profile. */
export const recruitmentInterests = pgTable("recruitment_interests", {
  id: uuid("id").primaryKey().defaultRandom(),
  recruitmentIntentId: uuid("recruitment_intent_id").notNull().references(() => recruitmentIntents.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  intentIndex: index("recruitment_interests_intent_idx").on(t.recruitmentIntentId),
  userIndex: index("recruitment_interests_user_idx").on(t.userId),
  oneInterestPerUser: uniqueIndex("recruitment_interests_one_user_per_intent_unique").on(t.recruitmentIntentId, t.userId),
}));

export type RecruitmentIntent = typeof recruitmentIntents.$inferSelect;
export type RecruitmentInterest = typeof recruitmentInterests.$inferSelect;
