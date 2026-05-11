import { pgTable, uuid, text, timestamp, unique } from "drizzle-orm/pg-core";
import { matches } from "./matches";
import { users } from "./users";

export const matchMvpVotes = pgTable("match_mvp_votes", {
  id: uuid("id").primaryKey().defaultRandom(),
  matchId: uuid("match_id").notNull().references(() => matches.id),
  playerUserId: uuid("player_user_id").references(() => users.id),
  playerName: text("player_name").notNull(),
  voterUserId: uuid("voter_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqVoterPerMatch: unique().on(t.matchId, t.voterUserId),
}));

export type MatchMvpVote = typeof matchMvpVotes.$inferSelect;
export type NewMatchMvpVote = typeof matchMvpVotes.$inferInsert;
