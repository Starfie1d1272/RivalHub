import { pgTable, uuid, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const userRoleEnum = pgEnum("user_role", ["user", "season_admin", "super_admin"]);

// 全局用户账号 — 通过 auth_id 关联 Supabase Auth
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  authId: uuid("auth_id").unique(), // Supabase auth.users FK
  email: text("email").notNull().unique(),

  // 权限
  role: userRoleEnum("role").notNull().default("user"),
  adminSeasonIds: uuid("admin_season_id").array().notNull().default(sql`'{}'::uuid[]`),

  // 基础信息（跨赛季持久）
  studentId: text("student_id"),          // 学号，毕业生填"毕业年份+学院"
  qq: text("qq"),
  perfectName: text("perfect_name"),       // 完美平台昵称
  displayName: text("display_name"),        // 用户自定义昵称（展示优先级最高）
  steamName: text("steam_name"),          // Steam 昵称
  steam64: text("steam64"),               // Steam 64 位 ID
  steamProfileUrl: text("steam_profile_url"), // Steam 个人资料链接
  avatarUrl: text("avatar_url"),               // Steam 头像 URL（报名时写入缓存；存量 NULL 数据在 player page 有 runtime fallback）

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
