import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

// TODO: define users table
// Stores global accounts — linked to Supabase Auth via auth_id
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  authId: uuid("auth_id").unique(), // Supabase auth.users FK
  email: text("email").notNull().unique(),
  steam64: text("steam64"),
  qq: text("qq"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
