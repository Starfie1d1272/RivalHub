import { pgTable, uuid, text, timestamp, boolean, unique } from "drizzle-orm/pg-core";
import { matches } from "./matches";
import { users } from "./users";
import { teams } from "./teams";
import { teamMembers } from "./teams";

export const matchRosters = pgTable("match_rosters", {
  id: uuid("id").defaultRandom().primaryKey(),
  matchId: uuid("match_id").notNull().references(() => matches.id),
  teamId: uuid("team_id").notNull().references(() => teams.id),
  submittedBy: uuid("submitted_by").notNull().references(() => users.id),
  status: text("status").notNull().default("submitted"),
  lockedAt: timestamp("locked_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  unq: unique().on(t.matchId, t.teamId),
}));

export const matchRosterPlayers = pgTable("match_roster_players", {
  rosterId: uuid("roster_id").notNull().references(() => matchRosters.id, { onDelete: "cascade" }),
  teamMemberId: uuid("team_member_id").notNull().references(() => teamMembers.id),
  isStarter: boolean("is_starter").notNull().default(true),
}, (t) => ({
  pk: unique().on(t.rosterId, t.teamMemberId),
}));
