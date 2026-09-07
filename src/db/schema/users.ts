import { sql } from "drizzle-orm";
import { check, foreignKey, pgTable, uuid, text, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["user", "super_admin"]);
export const emailVerificationSourceEnum = pgEnum("email_verification_source", ["signup_confirmation", "existing_account_reverification", "admin_migration"]);
export const userStatusEnum = pgEnum("user_status", ["active", "merged"]);

// 全局用户账号 — auth_id 只在已证明的 Supabase Auth 身份路径绑定
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  authId: uuid("auth_id").unique(), // verified Supabase Auth identity; no cross-schema FK
  email: text("email").notNull().unique(),
  /** Null means the RivalHub ownership fact is unknown; do not infer it from Auth history. */
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  emailVerificationSource: emailVerificationSourceEnum("email_verification_source"),
  status: userStatusEnum("status").notNull().default("active"),
  /** Set only after a successful canonical-user merge; the durable ledger owns details. */
  mergedIntoUserId: uuid("merged_into_user_id"),
  mergedAt: timestamp("merged_at", { withTimezone: true }),

  // 权限
  role: userRoleEnum("role").notNull().default("user"),

  // 基础信息（跨赛季持久）
  studentId: text("student_id"),          // legacy only; never use for Major eligibility
  qq: text("qq"),
  perfectName: text("perfect_name"),       // 完美平台昵称
  displayName: text("display_name"),        // 用户自定义昵称（展示优先级最高）
  steamName: text("steam_name"),          // Steam 昵称
  steam64: text("steam64"),               // Steam 64 位 ID
  steamProfileUrl: text("steam_profile_url"), // Steam 个人资料链接
  liveStreamUrl: text("live_stream_url"), // 解说时向观众展示的长期个人直播间
  avatarUrl: text("avatar_url"),               // Steam 头像 URL（报名时写入缓存；存量 NULL 数据在 player page 有 runtime fallback）

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  mergedIntoFk: foreignKey({
    columns: [t.mergedIntoUserId],
    foreignColumns: [t.id],
    name: "users_merged_into_user_id_users_id_fk",
  }).onDelete("restrict"),
  mergeShape: check(
    "users_merge_shape_check",
    sql`(${t.status} = 'active' AND ${t.mergedIntoUserId} IS NULL AND ${t.mergedAt} IS NULL)
      OR (${t.status} = 'merged' AND ${t.mergedIntoUserId} IS NOT NULL AND ${t.mergedIntoUserId} <> ${t.id} AND ${t.mergedAt} IS NOT NULL)`,
  ),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
