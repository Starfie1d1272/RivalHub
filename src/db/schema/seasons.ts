import { pgTable, uuid, text, timestamp, pgEnum } from "drizzle-orm/pg-core";

// TODO: complete season table definition with all status transitions
export const seasonKindEnum = pgEnum("season_kind", ["rivals", "major"]);
export const seasonStatusEnum = pgEnum("season_status", [
  "draft",        // not yet published
  "registration", // registration open
  "voting",       // captain voting phase
  "drafting",     // snake draft in progress
  "playing",      // matches ongoing
  "finished",     // season complete
  "archived",     // historical
]);

export const seasons = pgTable("seasons", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(), // e.g. "rivals-2026-spring"
  name: text("name").notNull(),          // e.g. "NJU Rivals 2026 Spring"
  kind: seasonKindEnum("kind").notNull(),
  status: seasonStatusEnum("status").notNull().default("draft"),
  themeColor: text("theme_color"),       // hex color for season theming
  startAt: timestamp("start_at", { withTimezone: true }),
  endAt: timestamp("end_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Season = typeof seasons.$inferSelect;
export type NewSeason = typeof seasons.$inferInsert;
