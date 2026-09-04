import { jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { ConversionPolicyMapping } from "@/lib/competitive/conversion-policy";

export const conversionPolicyStatusEnum = pgEnum("conversion_policy_status", ["draft", "approved", "retired"]);

/**
 * Platform-owned, versioned cross-platform conversion policy. A version's
 * mapping is immutable once approved; events freeze a snapshot at registration
 * open and never reinterpret it through a later policy version.
 */
export const conversionPolicies = pgTable("conversion_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourcePlatform: text("source_platform").notNull(),
  targetPlatform: text("target_platform").notNull(),
  version: text("version").notNull(),
  status: conversionPolicyStatusEnum("status").notNull().default("draft"),
  mapping: jsonb("mapping").$type<ConversionPolicyMapping>().notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedBy: uuid("approved_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ConversionPolicy = typeof conversionPolicies.$inferSelect;
