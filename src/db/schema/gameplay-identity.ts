import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { matchDemoImports } from "./demo-integration";
import { users } from "./users";

/** Gameplay identity is separate from login/profile ownership identity. */
export const gameplaySteamIdentityStatusEnum = pgEnum("gameplay_steam_identity_status", [
  "active",
  "retired",
]);

/** Provenance distinguishes a primary change from an operator-confirmed alternate. */
export const gameplaySteamIdentityProvenanceEnum = pgEnum("gameplay_steam_identity_provenance", [
  "profile_change",
  "admin_confirmed_alternate",
]);

export const userGameplaySteamIds = pgTable("user_gameplay_steam_ids", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  steam64: text("steam64").notNull(),
  status: gameplaySteamIdentityStatusEnum("status").notNull().default("active"),
  provenance: gameplaySteamIdentityProvenanceEnum("provenance").notNull(),
  sourceImportId: uuid("source_import_id").references(() => matchDemoImports.id, { onDelete: "set null" }),
  confirmedByUserId: uuid("confirmed_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
  reason: text("reason").notNull(),
  retiredByUserId: uuid("retired_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
  retiredReason: text("retired_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  steam64Shape: check("user_gameplay_steam_ids_steam64_shape_check", sql`${t.steam64} ~ '^[0-9]{17}$'`),
  statusShape: check(
    "user_gameplay_steam_ids_status_shape_check",
    sql`(${t.status} = 'active' AND ${t.retiredByUserId} IS NULL AND ${t.retiredAt} IS NULL AND ${t.retiredReason} IS NULL)
      OR (${t.status} = 'retired' AND ${t.retiredByUserId} IS NOT NULL AND ${t.retiredAt} IS NOT NULL AND length(trim(${t.retiredReason})) > 0)`,
  ),
  activeSteam64Unique: uniqueIndex("user_gameplay_steam_ids_active_steam64_unique")
    .on(t.steam64)
    .where(sql`${t.status} = 'active'`),
  userIndex: index("user_gameplay_steam_ids_user_id_idx").on(t.userId),
  sourceImportIndex: index("user_gameplay_steam_ids_source_import_id_idx").on(t.sourceImportId),
}));

export type UserGameplaySteamId = typeof userGameplaySteamIds.$inferSelect;
