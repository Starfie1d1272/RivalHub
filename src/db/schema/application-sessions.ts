import { sql } from "drizzle-orm";
import { index, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

/** Authentication registry; unrelated to the user_sessions presence heartbeat. */
export const applicationSessions = pgTable("application_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [index("application_sessions_user_idx").on(t.userId)]);

/** Durable issuance fence, serialized with session issuance through the user row lock. */
export const applicationSessionControls = pgTable("application_session_controls", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  revokedBefore: timestamp("revoked_before", { withTimezone: true }).notNull().default(sql`'epoch'::timestamptz`),
  passwordMutationId: uuid("password_mutation_id"),
});
