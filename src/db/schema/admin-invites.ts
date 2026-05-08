import { pgTable, uuid, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { adminRoleEnum } from "./admin-users";
import { seasons } from "./seasons";

// 管理员邀请码
export const adminInvites = pgTable("admin_invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  createdBy: text("created_by").notNull(),
  role: adminRoleEnum("role").notNull().default("admin"),
  // season_admin 邀请时绑定赛季，super_admin 邀请为 null
  seasonId: uuid("season_id").references(() => seasons.id),
  maxUses: integer("max_uses").notNull().default(1),
  usedCount: integer("used_count").notNull().default(0),
  usedByUsernames: text("used_by_usernames").array().notNull().default(sql`'{}'::text[]`),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AdminInvite = typeof adminInvites.$inferSelect;
export type NewAdminInvite = typeof adminInvites.$inferInsert;
