import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { matches } from "./matches";
import { users } from "./users";

export const matchTimeProposals = pgTable("match_time_proposals", {
  id: uuid("id").defaultRandom().primaryKey(),
  matchId: uuid("match_id").notNull().references(() => matches.id),
  proposedBy: uuid("proposed_by").notNull().references(() => users.id),
  forceAssignedBy: uuid("force_assigned_by").references(() => users.id),
  status: text("status").notNull().default("pending"),
  proposedTime: timestamp("proposed_time", { withTimezone: true }).notNull(),
  responseAt: timestamp("response_at", { withTimezone: true }),
  rejectReason: text("reject_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MatchTimeProposal = typeof matchTimeProposals.$inferSelect;
export type NewMatchTimeProposal = typeof matchTimeProposals.$inferInsert;
