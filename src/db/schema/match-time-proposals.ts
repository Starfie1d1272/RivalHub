import { pgTable, uuid, text, timestamp, index, uniqueIndex, pgEnum } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { matches } from "./matches";
import { users } from "./users";

export const timeResolutionEnum = pgEnum("match_time_resolution", ["participant_accept", "auto_timeout", "auto_cutoff", "admin_force"]);

export const matchTimeProposals = pgTable("match_time_proposals", {
  id: uuid("id").defaultRandom().primaryKey(),
  matchId: uuid("match_id").notNull().references(() => matches.id),
  proposedBy: uuid("proposed_by").notNull().references(() => users.id),
  forceAssignedBy: uuid("force_assigned_by").references(() => users.id),
  status: text("status").notNull().default("pending"),
  proposedTime: timestamp("proposed_time", { withTimezone: true }).notNull(),
  resolution: timeResolutionEnum("resolution"),
  responseAt: timestamp("response_at", { withTimezone: true }),
  rejectReason: text("reject_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ matchIndex: index("match_time_proposals_match_id_idx").on(t.matchId), activeProposal: uniqueIndex("match_time_proposals_one_pending").on(t.matchId).where(sql`${t.status} = 'pending'`) }));

export type MatchTimeProposal = typeof matchTimeProposals.$inferSelect;
export type NewMatchTimeProposal = typeof matchTimeProposals.$inferInsert;
