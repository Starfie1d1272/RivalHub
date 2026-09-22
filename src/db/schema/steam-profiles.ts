import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Current Steam-owned display projection, keyed by the durable Steam64 value. */
export const steamProfiles = pgTable("steam_profiles", {
  steam64: text("steam64").primaryKey(),
  personaName: text("persona_name").notNull(),
  profileUrl: text("profile_url").notNull(),
  avatarUrl: text("avatar_url"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  steam64Shape: check("steam_profiles_steam64_shape_check", sql`${t.steam64} ~ '^[0-9]{17}$'`),
}));

export type SteamProfile = typeof steamProfiles.$inferSelect;
export type NewSteamProfile = typeof steamProfiles.$inferInsert;
