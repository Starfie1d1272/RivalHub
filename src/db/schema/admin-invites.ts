import { pgTable, uuid, text, integer, boolean, timestamp, pgEnum, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { seasons } from "./seasons";

export const adminInviteRoleEnum = pgEnum("admin_invite_role", ["season_admin", "super_admin"]);

// 管理员邀请码
export const adminInvites = pgTable("admin_invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  createdBy: text("created_by").notNull(),
  role: adminInviteRoleEnum("role").notNull().default("season_admin"),
  seasonId: uuid("season_id").references(() => seasons.id),
  maxUses: integer("max_uses").notNull().default(1),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  maxUsesPositive: check("admin_invites_max_uses_positive", sql`${t.maxUses} > 0`),
  roleSeasonScope: check(
    "admin_invites_role_season_scope",
    sql`(${t.role} = 'season_admin' AND ${t.seasonId} IS NOT NULL) OR (${t.role} = 'super_admin' AND ${t.seasonId} IS NULL)`,
  ),
}));

export type AdminInvite = typeof adminInvites.$inferSelect;
export type NewAdminInvite = typeof adminInvites.$inferInsert;
