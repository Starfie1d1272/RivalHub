import { boolean, check, index, integer, numeric, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

export const competitiveFactKindEnum = pgEnum("competitive_fact_kind", ["historical_peak", "season_peak"]);
export const competitiveFactProvenanceEnum = pgEnum("competitive_fact_provenance", ["self_declared"]);
export const cs2RoleEnum = pgEnum("cs2_role", ["igl", "awper", "entry", "closer", "anchor", "support", "lurker"]);

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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  platformRankKeyUnique: uniqueIndex("competitive_platform_ranks_platform_rank_key_unique").on(t.platformKey, t.rankKey),
  platformSortOrderUnique: uniqueIndex("competitive_platform_ranks_platform_sort_order_unique").on(t.platformKey, t.sortOrder),
  platformLadderIndex: index("competitive_platform_ranks_platform_order_idx").on(t.platformKey, t.sortOrder),
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
  rank: text("rank").notNull(),
  /** The platform's canonical performance Rating; never a matchmaking score (e.g. Valve CS Rating). */
  rating: numeric("rating", { precision: 8, scale: 2 }).notNull(),
  provenance: competitiveFactProvenanceEnum("provenance").notNull().default("self_declared"),
  declaredAt: timestamp("declared_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  factIdentityUnique: uniqueIndex("competitive_rank_facts_identity_unique")
    .on(t.userId, t.platform, t.kind, sql`coalesce(${t.platformSeasonKey}, '')`),
  userPlatformIndex: index("competitive_rank_facts_user_platform_idx").on(t.userId, t.platform),
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

export type CompetitivePlatform = typeof competitivePlatforms.$inferSelect;
export type CompetitivePlatformRank = typeof competitivePlatformRanks.$inferSelect;
export type CompetitivePlatformSeason = typeof competitivePlatformSeasons.$inferSelect;
export type CompetitiveRankFact = typeof competitiveRankFacts.$inferSelect;
export type UserCompetitiveRole = typeof userCompetitiveRoles.$inferSelect;
