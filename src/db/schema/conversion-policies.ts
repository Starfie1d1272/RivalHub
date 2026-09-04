import { sql } from "drizzle-orm";
import { boolean, check, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
  isCurrent: boolean("is_current").notNull().default(false),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedBy: uuid("approved_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sourceTargetVersionUnique: uniqueIndex("conversion_policies_source_target_version_unique").on(t.sourcePlatform, t.targetPlatform, t.version),
  oneCurrentPerPair: uniqueIndex("conversion_policies_one_current_per_pair")
    .on(t.sourcePlatform, t.targetPlatform)
    .where(sql`${t.isCurrent}`),
  currentMustBeApproved: check("conversion_policies_current_must_be_approved", sql`NOT ${t.isCurrent} OR ${t.status} = 'approved'`),
}));

export type ConversionPolicy = typeof conversionPolicies.$inferSelect;
