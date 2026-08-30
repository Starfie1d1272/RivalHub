import { pgTable, uuid, integer, boolean, timestamp, text, unique } from "drizzle-orm/pg-core";
import { seasons } from "./seasons";
import { competitionEntries } from "./competition-entries";
import { seasonRegistrations } from "./registrations";

// Singleton row per season — tracks live draft state
export const draftState = pgTable("draft_state", {
  id: uuid("id").primaryKey().defaultRandom(),
  seasonId: uuid("season_id").notNull().unique().references(() => seasons.id),
  currentRound: integer("current_round").notNull().default(1),
  currentEntryId: uuid("current_entry_id").references(() => competitionEntries.id),
  roundDeadline: timestamp("round_deadline", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Each pick made during the snake draft
export const draftPicks = pgTable("draft_picks", {
  id: uuid("id").primaryKey().defaultRandom(),
  seasonId: uuid("season_id").notNull().references(() => seasons.id),
  entryId: uuid("entry_id").notNull().references(() => competitionEntries.id),
  registrationId: uuid("registration_id").notNull().references(() => seasonRegistrations.id),
  round: integer("round").notNull(),
  pickNumber: integer("pick_number").notNull(),
  autoPicked: boolean("auto_picked").notNull().default(false),
  clientRequestId: text("client_request_id").unique(), // idempotency key
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // 同一赛季内同一选手只能被选一次
  uniqueSeasonRegistration: unique().on(t.seasonId, t.registrationId),
}));

export type DraftState = typeof draftState.$inferSelect;
export type DraftPick = typeof draftPicks.$inferSelect;
export type NewDraftPick = typeof draftPicks.$inferInsert;
