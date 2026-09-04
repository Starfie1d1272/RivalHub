import { sql } from "drizzle-orm";
import { check, foreignKey, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { competitionEntries, competitionEntryRosterRevisions } from "./competition-entries";
import { seasons } from "./seasons";
import type { QualificationFinding } from "@/lib/qualification/finding";

/**
 * One explicit administrative decision against one typed, waivable finding.
 * The original qualification fact remains unchanged; this row records only
 * the durable, revision-scoped policy decision to release that restriction.
 */
export const competitionEntryRestrictionOverrides = pgTable("competition_entry_restriction_overrides", {
  id: uuid("id").primaryKey().defaultRandom(),
  competitionId: uuid("competition_id").notNull().references(() => seasons.id),
  entryId: uuid("entry_id").notNull().references(() => competitionEntries.id),
  rosterRevisionId: uuid("roster_revision_id").notNull().references(() => competitionEntryRosterRevisions.id),
  restrictionCode: text("restriction_code").notNull(),
  findingSnapshot: jsonb("finding_snapshot").$type<QualificationFinding>().notNull(),
  reason: text("reason").notNull(),
  grantedBy: text("granted_by").notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  revokedBy: text("revoked_by"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => ({
  activeOverrideUnique: uniqueIndex("competition_entry_restriction_overrides_active_unique")
    .on(t.entryId, t.rosterRevisionId, t.restrictionCode)
    .where(sql`${t.revokedAt} IS NULL`),
  entryIndex: index("competition_entry_restriction_overrides_entry_idx").on(t.entryId, t.rosterRevisionId),
  competitionIndex: index("competition_entry_restriction_overrides_competition_idx").on(t.competitionId),
  entryCompetitionScope: foreignKey({
    columns: [t.entryId, t.competitionId],
    foreignColumns: [competitionEntries.id, competitionEntries.competitionId],
    name: "competition_entry_restriction_overrides_entry_competition_scope_fk",
  }),
  revisionEntryScope: foreignKey({
    columns: [t.rosterRevisionId, t.entryId],
    foreignColumns: [competitionEntryRosterRevisions.id, competitionEntryRosterRevisions.entryId],
    name: "competition_entry_restriction_overrides_revision_entry_scope_fk",
  }),
  revokeShape: check(
    "competition_entry_restriction_overrides_revoke_shape_check",
    sql`(${t.revokedAt} IS NULL AND ${t.revokedBy} IS NULL) OR (${t.revokedAt} IS NOT NULL AND ${t.revokedBy} IS NOT NULL)`,
  ),
  nonEmptyCode: check("competition_entry_restriction_overrides_code_non_empty_check", sql`length(trim(${t.restrictionCode})) > 0`),
  nonEmptyReason: check("competition_entry_restriction_overrides_reason_non_empty_check", sql`length(trim(${t.reason})) > 0`),
}));

export type CompetitionEntryRestrictionOverride = typeof competitionEntryRestrictionOverrides.$inferSelect;
export type NewCompetitionEntryRestrictionOverride = typeof competitionEntryRestrictionOverrides.$inferInsert;
