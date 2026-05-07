import { pgTable, uuid, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { seasons } from "./seasons";

// All admin actions are logged here — no exceptions
export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  seasonId: uuid("season_id").references(() => seasons.id), // null for global actions
  action: text("action").notNull(),           // e.g. "registration.approve"
  actorId: text("actor_id"),                  // admin identifier
  targetId: text("target_id"),                // affected entity id
  targetType: text("target_type"),            // e.g. "registration", "team"
  meta: jsonb("meta"),                        // arbitrary context payload
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
