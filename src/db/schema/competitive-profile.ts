import { boolean, index, json, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

export const competitiveFactKindEnum = pgEnum("competitive_fact_kind", ["historical_peak", "season_peak"]);
export const competitiveFactProvenanceEnum = pgEnum("competitive_fact_provenance", ["self_declared"]);

/**
 * Operator-owned platform season catalogue.  Keys intentionally are not tied
 * to a vendor's Sxx naming: a future platform can choose its own stable key.
 */
export const competitivePlatformSeasons = pgTable("competitive_platform_seasons", {
  id: uuid("id").primaryKey().defaultRandom(),
  platform: text("platform").notNull(),
  seasonKey: text("season_key").notNull(),
  label: text("label").notNull(),
  /** Lowest → highest canonical rank codes for this platform season. */
  rankOrder: json("rank_order").$type<string[]>().notNull().default(sql`'[]'::json`),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  platformSeasonUnique: uniqueIndex("competitive_platform_seasons_platform_key_unique").on(t.platform, t.seasonKey),
}));

/** A self-declared, reviewable rank fact. It is not a mutable users-column snapshot. */
export const competitiveRankFacts = pgTable("competitive_rank_facts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  kind: competitiveFactKindEnum("kind").notNull(),
  /** Required for season_peak; null only for the cross-season historical peak. */
  platformSeasonKey: text("platform_season_key"),
  rank: text("rank").notNull(),
  rating: numeric("rating", { precision: 8, scale: 2 }).notNull(),
  provenance: competitiveFactProvenanceEnum("provenance").notNull().default("self_declared"),
  declaredAt: timestamp("declared_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  factIdentityUnique: uniqueIndex("competitive_rank_facts_identity_unique")
    .on(t.userId, t.platform, t.kind, sql`coalesce(${t.platformSeasonKey}, '')`),
  userPlatformIndex: index("competitive_rank_facts_user_platform_idx").on(t.userId, t.platform),
}));

export type CompetitivePlatformSeason = typeof competitivePlatformSeasons.$inferSelect;
export type CompetitiveRankFact = typeof competitiveRankFacts.$inferSelect;
