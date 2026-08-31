import { pgTable, uuid, timestamp, unique, index } from "drizzle-orm/pg-core";
import { users } from "./users";
import { seasons } from "./seasons";

/** Current season-scoped administrator grants. */
export const seasonAdminGrants = pgTable("season_admin_grants", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  seasonId: uuid("season_id").notNull().references(() => seasons.id, { onDelete: "cascade" }),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  grantedByUserId: uuid("granted_by_user_id").references(() => users.id, { onDelete: "set null" }),
}, (t) => ({
  userSeasonUnique: unique("season_admin_grants_user_season_unique").on(t.userId, t.seasonId),
  userIdIndex: index("season_admin_grants_user_id_idx").on(t.userId),
  seasonIdIndex: index("season_admin_grants_season_id_idx").on(t.seasonId),
}));

export type SeasonAdminGrant = typeof seasonAdminGrants.$inferSelect;
export type NewSeasonAdminGrant = typeof seasonAdminGrants.$inferInsert;
