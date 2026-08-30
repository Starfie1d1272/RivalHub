import { pgTable, uuid, text, timestamp, boolean, unique } from "drizzle-orm/pg-core";
import { matches } from "./matches";
import { users } from "./users";
import { competitionEntries, eventRosterMembers } from "./competition-entries";

export const matchRosters = pgTable("match_rosters", {
  id: uuid("id").defaultRandom().primaryKey(),
  matchId: uuid("match_id").notNull().references(() => matches.id),
  entryId: uuid("entry_id").notNull().references(() => competitionEntries.id),
  /** The participant who submitted; null when an admin selected the lineup. */
  submittedBy: uuid("submitted_by").references(() => users.id),
  /** participant | admin_select — who authored this explicit lineup. */
  source: text("source").notNull().default("participant"),
  status: text("status").notNull().default("submitted"),
  lockedAt: timestamp("locked_at", { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  confirmedBy: text("confirmed_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  unq: unique().on(t.matchId, t.entryId),
}));

export const matchRosterPlayers = pgTable("match_roster_players", {
  rosterId: uuid("roster_id").notNull().references(() => matchRosters.id, { onDelete: "cascade" }),
  eventRosterMemberId: uuid("event_roster_member_id").notNull().references(() => eventRosterMembers.id),
  isStarter: boolean("is_starter").notNull().default(true),
}, (t) => ({
  pk: unique().on(t.rosterId, t.eventRosterMemberId),
}));
