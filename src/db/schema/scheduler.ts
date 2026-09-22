import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Bounded current health projection for the scheduler. This is deliberately
 * not an execution/event ledger and is never exposed through the Data API.
 */
export const scheduledJobHealth = pgTable("scheduled_job_health", {
  jobKey: text("job_key").primaryKey(),
  lastPrimaryTriggeredAt: timestamp("last_primary_triggered_at", { withTimezone: true }),
  lastPrimaryEndpointStartedAt: timestamp("last_primary_endpoint_started_at", { withTimezone: true }),
  lastPrimaryEndpointSucceededAt: timestamp("last_primary_endpoint_succeeded_at", { withTimezone: true }),
  lastWatchdogSucceededAt: timestamp("last_watchdog_succeeded_at", { withTimezone: true }),
  lastManualSucceededAt: timestamp("last_manual_succeeded_at", { withTimezone: true }),
  lastBusinessTransitionAt: timestamp("last_business_transition_at", { withTimezone: true }),
  lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
  lastFailureSource: text("last_failure_source"),
  lastFailureCode: text("last_failure_code"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ScheduledJobHealth = typeof scheduledJobHealth.$inferSelect;
export type NewScheduledJobHealth = typeof scheduledJobHealth.$inferInsert;
