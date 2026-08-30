import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { majorFinalResults } from "./major-stage";
import { matches } from "./matches";
import { seasons } from "./seasons";
import { competitionEntries } from "./competition-entries";
import { users } from "./users";

export const adjudicationStatusEnum = pgEnum("adjudication_status", ["active", "revoked"]);
export const adjudicationKindEnum = pgEnum("adjudication_kind", [
  "team_sanction",
  "result_statement",
  "placement_statement",
  "honor_directive",
]);
export const adjudicationTargetEnum = pgEnum("adjudication_target", ["season", "entry", "user", "match"]);
export const adjudicationImpactEnum = pgEnum("adjudication_impact", [
  "canonical_matches",
  "final_result",
  "official_placements",
  "honors",
  "none",
]);

/**
 * An explicit post-event ruling. This is a record of the administrator's
 * decision, not another source of match truth: canonical match corrections
 * remain exclusively in the G2 correction flow.
 */
export const postEventAdjudications = pgTable("post_event_adjudications", {
  id: uuid("id").defaultRandom().primaryKey(),
  seasonId: uuid("season_id").notNull().references(() => seasons.id),
  /** Durable retry key supplied by the caller, never generated server-side. */
  clientRequestId: uuid("client_request_id").notNull().unique(),
  status: adjudicationStatusEnum("status").notNull().default("active"),
  kind: adjudicationKindEnum("kind").notNull(),
  target: adjudicationTargetEnum("target").notNull(),
  impacts: jsonb("impacts").$type<AdjudicationImpact[]>().notNull().default(sql`'[]'::jsonb`),
  targetEntryId: uuid("target_entry_id").references(() => competitionEntries.id),
  targetUserId: uuid("target_user_id").references(() => users.id),
  targetMatchId: uuid("target_match_id").references(() => matches.id),
  reason: text("reason").notNull(),
  publicExplanation: text("public_explanation").notNull(),
  /** Privileged-only evidence. Never include this column in public serializers. */
  internalEvidence: text("internal_evidence"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedBy: text("revoked_by"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revocationReason: text("revocation_reason"),
}, (t) => ({
  seasonIndex: index("post_event_adjudications_season_idx").on(t.seasonId),
  targetCheck: check(
    "post_event_adjudications_target_check",
    sql`(${t.target} = 'season' AND ${t.targetEntryId} IS NULL AND ${t.targetUserId} IS NULL AND ${t.targetMatchId} IS NULL)
      OR (${t.target} = 'entry' AND ${t.targetEntryId} IS NOT NULL AND ${t.targetUserId} IS NULL AND ${t.targetMatchId} IS NULL)
      OR (${t.target} = 'user' AND ${t.targetEntryId} IS NULL AND ${t.targetUserId} IS NOT NULL AND ${t.targetMatchId} IS NULL)
      OR (${t.target} = 'match' AND ${t.targetEntryId} IS NULL AND ${t.targetUserId} IS NULL AND ${t.targetMatchId} IS NOT NULL)`,
  ),
  revocationCheck: check(
    "post_event_adjudications_revocation_check",
    sql`(${t.status} = 'revoked') = (${t.revokedAt} IS NOT NULL)`,
  ),
  impactsAreArray: check(
    "post_event_adjudications_impacts_array_check",
    sql`jsonb_typeof(${t.impacts}) = 'array'`,
  ),
}));

export const honorTypeEnum = pgEnum("honor_type", ["champion", "runner_up", "placement", "manual_award"]);
export const honorStateEnum = pgEnum("honor_state", ["valid", "revoked", "vacant", "not_awarded"]);
export const honorBasisEnum = pgEnum("honor_basis", ["final_result", "manual", "adjudication"]);

/**
 * A separately-auditable honor fact. It deliberately never recalculates or
 * changes matches/final placement. A new recipient must be explicitly
 * granted as a new row after revocation; no runner-up promotion exists here.
 */
export const tournamentHonors = pgTable("tournament_honors", {
  id: uuid("id").defaultRandom().primaryKey(),
  seasonId: uuid("season_id").notNull().references(() => seasons.id),
  clientRequestId: uuid("client_request_id").notNull().unique(),
  /** Stable slot key: champion, runner_up, placement:3-4:<team>, or manual:<slug>. */
  honorKey: text("honor_key").notNull(),
  type: honorTypeEnum("type").notNull(),
  label: text("label").notNull(),
  state: honorStateEnum("state").notNull().default("valid"),
  basis: honorBasisEnum("basis").notNull(),
  placementFrom: integer("placement_from"),
  placementTo: integer("placement_to"),
  entryId: uuid("entry_id").references(() => competitionEntries.id),
  userId: uuid("user_id").references(() => users.id),
  sourceFinalResultId: uuid("source_final_result_id").references(() => majorFinalResults.id),
  adjudicationId: uuid("adjudication_id").references(() => postEventAdjudications.id),
  awardedBy: text("awarded_by").notNull(),
  awardedAt: timestamp("awarded_at", { withTimezone: true }).notNull().defaultNow(),
  revokedBy: text("revoked_by"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revocationReason: text("revocation_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  seasonIndex: index("tournament_honors_season_idx").on(t.seasonId),
  onlyOneValidSlot: uniqueIndex("tournament_honors_one_valid_slot_unique")
    .on(t.seasonId, t.honorKey)
    .where(sql`${t.state} = 'valid'`),
  recipientCheck: check(
    "tournament_honors_recipient_check",
    sql`(${t.state} IN ('valid', 'revoked') AND ((${t.entryId} IS NOT NULL)::int + (${t.userId} IS NOT NULL)::int) = 1)
      OR (${t.state} IN ('vacant', 'not_awarded') AND ${t.entryId} IS NULL AND ${t.userId} IS NULL)`,
  ),
  placementCheck: check(
    "tournament_honors_placement_check",
    sql`(${t.type} = 'placement' AND ${t.placementFrom} IS NOT NULL AND ${t.placementTo} IS NOT NULL AND ${t.placementFrom} > 0 AND ${t.placementTo} >= ${t.placementFrom})
      OR (${t.type} <> 'placement' AND ${t.placementFrom} IS NULL AND ${t.placementTo} IS NULL)`,
  ),
  revocationCheck: check(
    "tournament_honors_revocation_check",
    sql`(${t.state} = 'revoked') = (${t.revokedAt} IS NOT NULL)`,
  ),
  nonBlankKey: check("tournament_honors_non_blank_key_check", sql`length(trim(${t.honorKey})) > 0`),
}));

export type AdjudicationImpact = "canonical_matches" | "final_result" | "official_placements" | "honors" | "none";
export type PostEventAdjudication = typeof postEventAdjudications.$inferSelect;
export type TournamentHonor = typeof tournamentHonors.$inferSelect;
