import { pgTable, uuid, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

/** 用户活跃心跳表 — 用于在线人数统计，非鉴权用途 */
export const userSessions = pgTable("user_sessions", {
  userId: uuid("user_id").primaryKey().references(() => users.id),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
});
