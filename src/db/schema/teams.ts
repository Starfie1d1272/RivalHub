import { pgTable, uuid, text, integer, boolean, timestamp, unique } from "drizzle-orm/pg-core";
import { seasons } from "./seasons";
import { seasonRegistrations } from "./registrations";

// TODO: add team status enum if needed
export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  seasonId: uuid("season_id").notNull().references(() => seasons.id),
  name: text("name").notNull(),
  logoUrl: text("logo_url"),
  captainRegistrationId: uuid("captain_registration_id")
    .notNull()
    .references(() => seasonRegistrations.id),
  draftOrder: integer("draft_order").notNull(), // 1-based snake draft order
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqueSeasonDraftOrder: unique().on(t.seasonId, t.draftOrder),
}));

export const teamMembers = pgTable("team_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").notNull().references(() => teams.id),
  registrationId: uuid("registration_id").notNull().references(() => seasonRegistrations.id),
  isStarter: boolean("is_starter").notNull().default(false),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqueRegistration: unique().on(t.registrationId),
}));

export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
export type TeamMember = typeof teamMembers.$inferSelect;
export type NewTeamMember = typeof teamMembers.$inferInsert;
