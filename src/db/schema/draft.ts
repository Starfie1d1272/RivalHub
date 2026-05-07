import { pgTable, uuid, integer, boolean, timestamp, text } from "drizzle-orm/pg-core";
import { seasons } from "./seasons";
import { teams } from "./teams";
import { seasonRegistrations } from "./registrations";

// Singleton row per season — tracks live draft state
export const draftState = pgTable("draft_state", {
  id: uuid("id").primaryKey().defaultRandom(),
  seasonId: uuid("season_id").notNull().unique().references(() => seasons.id),
  currentRound: integer("current_round").notNull().default(1),
  currentTeamId: uuid("current_team_id").references(() => teams.id),
  roundDeadline: timestamp("round_deadline", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Each pick made during the snake draft
export const draftPicks = pgTable("draft_picks", {
  id: uuid("id").primaryKey().defaultRandom(),
  seasonId: uuid("season_id").notNull().references(() => seasons.id),
  teamId: uuid("team_id").notNull().references(() => teams.id),
  registrationId: uuid("registration_id").notNull().references(() => seasonRegistrations.id),
  round: integer("round").notNull(),
  pickNumber: integer("pick_number").notNull(),
  autoPicked: boolean("auto_picked").notNull().default(false),
  clientRequestId: text("client_request_id").unique(), // idempotency key
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DraftState = typeof draftState.$inferSelect;
export type DraftPick = typeof draftPicks.$inferSelect;
export type NewDraftPick = typeof draftPicks.$inferInsert;
