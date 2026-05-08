import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

// 全局用户账号 — 通过 auth_id 关联 Supabase Auth
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  authId: uuid("auth_id").unique(), // Supabase auth.users FK
  email: text("email").notNull().unique(),

  // 基础信息（跨赛季持久）
  studentId: text("student_id"),          // 学号，毕业生填"毕业年份+学院"
  qq: text("qq"),
  perfectId: text("perfect_id"),          // 完美平台 ID
  steamName: text("steam_name"),          // Steam 昵称
  steam64: text("steam64"),               // Steam 64 位 ID
  steamProfileUrl: text("steam_profile_url"), // Steam 个人资料链接

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
