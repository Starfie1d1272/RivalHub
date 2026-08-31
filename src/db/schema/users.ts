import { pgTable, uuid, text, timestamp, pgEnum, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const userRoleEnum = pgEnum("user_role", ["user", "super_admin"]);
export const emailVerificationSourceEnum = pgEnum("email_verification_source", ["signup_confirmation", "existing_account_reverification", "admin_migration"]);

// 全局用户账号 — 通过 auth_id 关联 Supabase Auth
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  authId: uuid("auth_id").unique(), // Supabase auth.users FK
  email: text("email").notNull().unique(),
  /** Null means the RivalHub ownership fact is unknown; do not infer it from Auth history. */
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  emailVerificationSource: emailVerificationSourceEnum("email_verification_source"),

  // 权限
  role: userRoleEnum("role").notNull().default("user"),

  // 基础信息（跨赛季持久）
  studentId: text("student_id"),          // legacy only; never use for Major eligibility
  qq: text("qq"),
  perfectName: text("perfect_name"),       // 完美平台昵称
  /** 完美世界竞技平台的账号 ID；与昵称分开，并按规范化值唯一。 */
  perfectId: text("perfect_id"),
  displayName: text("display_name"),        // 用户自定义昵称（展示优先级最高）
  steamName: text("steam_name"),          // Steam 昵称
  steam64: text("steam64"),               // Steam 64 位 ID
  steamProfileUrl: text("steam_profile_url"), // Steam 个人资料链接
  avatarUrl: text("avatar_url"),               // Steam 头像 URL（报名时写入缓存；存量 NULL 数据在 player page 有 runtime fallback）

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  perfectIdNormalizedUnique: uniqueIndex("users_perfect_id_normalized_unique")
    .on(sql`lower(btrim(${t.perfectId}))`),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
