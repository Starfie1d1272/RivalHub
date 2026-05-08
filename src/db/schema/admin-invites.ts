import { pgTable, uuid, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { adminUsers, adminRoleEnum } from "./admin-users";

// 管理员邀请码
export const adminInvites = pgTable("admin_invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  createdBy: uuid("created_by").references(() => adminUsers.id).notNull(),
  role: adminRoleEnum("role").notNull().default("admin"),
  maxUses: integer("max_uses").notNull().default(1),
  usedCount: integer("used_count").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AdminInvite = typeof adminInvites.$inferSelect;
export type NewAdminInvite = typeof adminInvites.$inferInsert;
