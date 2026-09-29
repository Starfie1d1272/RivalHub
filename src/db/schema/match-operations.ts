import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, integer, uniqueIndex, check } from "drizzle-orm/pg-core";
import { seasons } from "./seasons";
import { matches } from "./matches";
import { competitionEntries } from "./competition-entries";

export const officialCoverageSlots = pgTable("official_coverage_slots", {
  id: uuid("id").defaultRandom().primaryKey(),
  seasonId: uuid("season_id").notNull().references(() => seasons.id),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  capacity: integer("capacity").notNull(),
  allocationPolicy: text("allocation_policy").notNull().default("first_confirmed"),
  note: text("note"),
}, t => [check("coverage_slot_window", sql`${t.endsAt} > ${t.startsAt} AND ${t.capacity} > 0`)]);

// Expiration releases capacity, never the independent scheduling proposal.
export const coverageHolds = pgTable("coverage_holds", {
  id: uuid("id").defaultRandom().primaryKey(),
  slotId: uuid("slot_id").notNull().references(() => officialCoverageSlots.id),
  matchId: uuid("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
  proposedScheduledAt: timestamp("proposed_scheduled_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  releasedAt: timestamp("released_at", { withTimezone: true }),
}, t => [uniqueIndex("coverage_one_active_hold").on(t.matchId).where(sql`${t.releasedAt} IS NULL`)]);

export const coverageAllocations = pgTable("coverage_allocations", {
  id: uuid("id").defaultRandom().primaryKey(),
  slotId: uuid("slot_id").notNull().references(() => officialCoverageSlots.id),
  matchId: uuid("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  releasedAt: timestamp("released_at", { withTimezone: true }),
}, t => [uniqueIndex("coverage_one_active_allocation").on(t.matchId).where(sql`${t.releasedAt} IS NULL`)]);

export const matchLineupIncidents = pgTable("match_lineup_incidents", {
  id: uuid("id").defaultRandom().primaryKey(),
  matchId: uuid("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
  entryId: uuid("entry_id").notNull().references(() => competitionEntries.id),
  actorId: text("actor_id").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
