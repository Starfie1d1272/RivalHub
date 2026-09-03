import { boolean, check, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { CS2_POSITION_VALUES } from "@/lib/config/cs2-positions";
import type { MapPreference } from "@/types/season";

export const competitiveFactKindEnum = pgEnum("competitive_fact_kind", ["historical_peak", "season_peak"]);
export const competitiveFactProvenanceEnum = pgEnum("competitive_fact_provenance", ["self_declared"]);
export const competitiveFactStatusEnum = pgEnum("competitive_fact_status", ["ranked", "unranked"]);
export const cs2RoleEnum = pgEnum("cs2_role", CS2_POSITION_VALUES);

/**
 * Long-lived competitive platform identity. The technical key is immutable
 * after creation; display and canonical performance-Rating names are
 * operator-maintained. Rating here is never a matchmaking / ladder score.
 */
export const competitivePlatforms = pgTable("competitive_platforms", {
  key: text("key").primaryKey(),
  displayName: text("display_name").notNull(),
  ratingLabel: text("rating_label").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Platform-owned rank ladder. rankKey is the stable identity stored in
 * competitive_rank_facts and frozen event contexts; label is the mutable
 * display name. sortOrder means lowest → highest.
 */
export const competitivePlatformRanks = pgTable("competitive_platform_ranks", {
  id: uuid("id").primaryKey().defaultRandom(),
  platformKey: text("platform_key").notNull().references(() => competitivePlatforms.key, { onDelete: "restrict" }),
  rankKey: text("rank_key").notNull(),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull(),
  /** Inclusive lower bound for star-based ranks; null/null means no stars. */
  starMin: integer("star_min"),
  /** Inclusive upper bound; null with starMin means no upper bound. */
  starMax: integer("star_max"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  platformRankKeyUnique: uniqueIndex("competitive_platform_ranks_platform_rank_key_unique").on(t.platformKey, t.rankKey),
  platformSortOrderUnique: uniqueIndex("competitive_platform_ranks_platform_sort_order_unique").on(t.platformKey, t.sortOrder),
  platformLadderIndex: index("competitive_platform_ranks_platform_order_idx").on(t.platformKey, t.sortOrder),
  starRangeShape: check("competitive_platform_ranks_star_range_shape", sql`(${t.starMin} IS NULL AND ${t.starMax} IS NULL) OR ${t.starMin} IS NOT NULL`),
  starMinNonNegative: check("competitive_platform_ranks_star_min_non_negative", sql`${t.starMin} IS NULL OR ${t.starMin} >= 0`),
  starMaxNonNegative: check("competitive_platform_ranks_star_max_non_negative", sql`${t.starMax} IS NULL OR ${t.starMax} >= 0`),
  starRangeOrdered: check("competitive_platform_ranks_star_range_ordered", sql`${t.starMax} IS NULL OR ${t.starMax} >= ${t.starMin}`),
}));

/**
 * Season catalogue of a competitive platform. Seasons only express chronology
 * and the current pointer; the rank ladder lives on the platform, never here.
 */
export const competitivePlatformSeasons = pgTable("competitive_platform_seasons", {
  id: uuid("id").primaryKey().defaultRandom(),
  platform: text("platform").notNull().references(() => competitivePlatforms.key, { onDelete: "restrict" }),
  seasonKey: text("season_key").notNull(),
  label: text("label").notNull(),
  active: boolean("active").notNull().default(true),
  /** Explicit chronology is global platform metadata, never a tournament setting. */
  sortOrder: integer("sort_order").notNull().default(0),
  /** One current season per platform; inactive catalog entries cannot be current. */
  isCurrent: boolean("is_current").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  platformSeasonUnique: uniqueIndex("competitive_platform_seasons_platform_key_unique").on(t.platform, t.seasonKey),
  platformCurrentUnique: uniqueIndex("competitive_platform_seasons_one_current_per_platform")
    .on(t.platform)
    .where(sql`${t.isCurrent}`),
  platformChronologyIndex: index("competitive_platform_seasons_platform_order_idx").on(t.platform, t.sortOrder),
  platformSortOrderUnique: uniqueIndex("competitive_platform_seasons_platform_sort_order_unique").on(t.platform, t.sortOrder),
  currentMustBeActive: check("competitive_platform_seasons_current_must_be_active", sql`NOT ${t.isCurrent} OR ${t.active}`),
}));

/** A self-declared, reviewable rank fact. It is not a mutable users-column snapshot. */
export const competitiveRankFacts = pgTable("competitive_rank_facts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  kind: competitiveFactKindEnum("kind").notNull(),
  /** Required for season_peak; null only for the cross-season historical peak. */
  platformSeasonKey: text("platform_season_key"),
  /** A season fact can be an explicit unranked declaration. */
  status: competitiveFactStatusEnum("status").notNull().default("ranked"),
  rank: text("rank"),
  /** The platform's canonical performance Rating; never a matchmaking score (e.g. Valve CS Rating). */
  rating: numeric("rating", { precision: 8, scale: 2 }),
  /** Exact self-declared in-rank progress. Legacy facts intentionally remain null. */
  stars: integer("stars"),
  /** Optional provenance for historical_peak; never replaces season fact identity. */
  achievedSeasonKey: text("achieved_season_key"),
  provenance: competitiveFactProvenanceEnum("provenance").notNull().default("self_declared"),
  declaredAt: timestamp("declared_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  factIdentityUnique: uniqueIndex("competitive_rank_facts_identity_unique")
    .on(t.userId, t.platform, t.kind, sql`coalesce(${t.platformSeasonKey}, '')`),
  userPlatformIndex: index("competitive_rank_facts_user_platform_idx").on(t.userId, t.platform),
  starsNonNegative: check("competitive_rank_facts_stars_non_negative", sql`${t.stars} IS NULL OR ${t.stars} >= 0`),
  validFactShape: check("competitive_rank_facts_valid_fact_shape", sql`
    (
      ${t.kind} = 'historical_peak'
      AND ${t.status} = 'ranked'
      AND ${t.platformSeasonKey} IS NULL
      AND ${t.rank} IS NOT NULL
      AND ${t.rating} IS NOT NULL
    ) OR (
      ${t.kind} = 'season_peak'
      AND ${t.platformSeasonKey} IS NOT NULL
      AND (
        (${t.status} = 'ranked' AND ${t.rank} IS NOT NULL AND ${t.rating} IS NOT NULL)
        OR (${t.status} = 'unranked' AND ${t.rank} IS NULL AND ${t.stars} IS NULL)
      )
    )
  `),
  achievedSeasonOnlyForHistoricalPeak: check("competitive_rank_facts_achieved_season_shape", sql`
    (${t.kind} = 'historical_peak') OR ${t.achievedSeasonKey} IS NULL
  `),
}));

/** Long-lived self-declared preferences. They are hints, never eligibility gates. */
export const userCompetitiveRoles = pgTable("user_competitive_roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: cs2RoleEnum("role").notNull(),
  isPrimary: boolean("is_primary").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userRoleUnique: unique("user_competitive_roles_user_role_unique").on(t.userId, t.role),
  onePrimaryRolePerUser: uniqueIndex("user_competitive_roles_one_primary_per_user")
    .on(t.userId)
    .where(sql`${t.isPrimary}`),
  userIndex: index("user_competitive_roles_user_idx").on(t.userId),
}));

/**
 * Long-lived map proficiency, decoupled from any single season registration.
 * One canonical set per user over the product's CS2 map pool; season
 * registrations pre-fill from here and may snapshot a per-event override.
 */
export const userMapPreferences = pgTable("user_map_preferences", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  mapPreferences: jsonb("map_preferences").$type<MapPreference[]>().notNull().default(sql`'[]'::jsonb`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CompetitivePlatform = typeof competitivePlatforms.$inferSelect;
export type CompetitivePlatformRank = typeof competitivePlatformRanks.$inferSelect;
export type CompetitivePlatformSeason = typeof competitivePlatformSeasons.$inferSelect;
export type CompetitiveRankFact = typeof competitiveRankFacts.$inferSelect;
export type UserCompetitiveRole = typeof userCompetitiveRoles.$inferSelect;
export type UserMapPreferences = typeof userMapPreferences.$inferSelect;
