import { pgTable, uuid, timestamp, unique } from "drizzle-orm/pg-core";
import { seasonRegistrations } from "./registrations";

// Each voter can vote for at most 3 candidates per season (enforced in Server Action)
// Unique constraint prevents double-voting for the same candidate
export const captainVotes = pgTable(
  "captain_votes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    voterRegistrationId: uuid("voter_registration_id")
      .notNull()
      .references(() => seasonRegistrations.id),
    candidateRegistrationId: uuid("candidate_registration_id")
      .notNull()
      .references(() => seasonRegistrations.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueVote: unique().on(t.voterRegistrationId, t.candidateRegistrationId),
  })
);

export type CaptainVote = typeof captainVotes.$inferSelect;
export type NewCaptainVote = typeof captainVotes.$inferInsert;
