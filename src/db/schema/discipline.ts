import { check, index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { seasons } from "./seasons";
import { users } from "./users";

export const sanctionStatusEnum = pgEnum("sanction_status", [
  "draft",
  "active",
  "expired",
  "revoked",
]);

/** Explicit capability-level effects. Absence of an effect means no enforcement. */
export const sanctionEffectEnum = pgEnum("sanction_effect", [
  "registration_block",
  "roster_block",
  "match_participation_block",
]);

/**
 * A single disciplinary case against one subject. Personal facts only:
 * nothing here cascades into team eligibility, historical match results,
 * placements or honors — those require their own explicit adjudications.
 * `internal_evidence` must never reach any public serialization.
 */
export const disciplinaryCases = pgTable("disciplinary_cases", {
  id: uuid("id").defaultRandom().primaryKey(),
  seasonId: uuid("season_id").notNull().references(() => seasons.id),
  subjectUserId: uuid("subject_user_id").notNull().references(() => users.id),
  status: sanctionStatusEnum("status").notNull().default("draft"),
  effects: jsonb("effects").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  /** Admin-visible evidence trail. Never serialized publicly. */
  internalEvidence: text("internal_evidence"),
  /** Explainable-to-public summary. May be shown on public pages. */
  publicExplanation: text("public_explanation"),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
  /** Open-ended when null. A past window renders an active case inert. */
  effectiveUntil: timestamp("effective_until", { withTimezone: true }),
  issuedBy: text("issued_by").notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedBy: text("revoked_by"),
  revocationReason: text("revocation_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  seasonSubjectIndex: index("disciplinary_cases_season_subject_idx").on(t.seasonId, t.subjectUserId),
  statusIndex: index("disciplinary_cases_status_idx").on(t.status),
  consistentRevocation: check(
    "disciplinary_cases_revocation_consistent_check",
    sql`(${t.status} = 'revoked') = (${t.revokedAt} IS NOT NULL)`,
  ),
  saneWindow: check(
    "disciplinary_cases_window_sane_check",
    sql`${t.effectiveUntil} IS NULL OR ${t.effectiveUntil} > ${t.effectiveFrom}`,
  ),
}));

/** Uniqueness guard so a retry of an issue call cannot duplicate a decision. */
export const disciplinaryCaseIdempotency = pgTable("disciplinary_case_idempotency", {
  clientRequestId: uuid("client_request_id").primaryKey(),
  caseId: uuid("case_id")
    .notNull()
    .references(() => disciplinaryCases.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DisciplinaryCase = typeof disciplinaryCases.$inferSelect;
