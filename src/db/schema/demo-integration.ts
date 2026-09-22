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
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { matchMaps, sideEnum } from "./match-maps";
import { matches } from "./matches";
import { users } from "./users";

/** A pending browser authorization request; only the poll-token hash is stored. */
export const dakPairingIntentStatusEnum = pgEnum("dak_pairing_intent_status", [
  "pending",
  "authorized",
  "expired",
]);

/** A long-lived device credential, revocable without touching the user session. */
export const dakPairingStatusEnum = pgEnum("dak_pairing_status", ["active", "revoked"]);

export const matchDemoImportStatusEnum = pgEnum("match_demo_import_status", [
  "pending",
  "confirmed",
  "rejected",
  "stale",
  "superseded",
  "needs_attention",
]);

export const demoRoundPhaseEnum = pgEnum("demo_round_phase", ["regulation", "overtime"]);
export const demoEconomyTypeEnum = pgEnum("demo_economy_type", ["pistol", "eco", "semi", "force", "full"]);

export const dakPairingIntents = pgTable("dak_pairing_intents", {
  id: uuid("id").primaryKey().defaultRandom(),
  pollTokenHash: text("poll_token_hash").notNull().unique(),
  status: dakPairingIntentStatusEnum("status").notNull().default("pending"),
  authorizedByUserId: uuid("authorized_by_user_id").references(() => users.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  authorizedAt: timestamp("authorized_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  statusShape: check(
    "dak_pairing_intents_status_shape_check",
    sql`(${t.status} = 'pending' AND ${t.authorizedByUserId} IS NULL AND ${t.authorizedAt} IS NULL)
      OR (${t.status} = 'authorized' AND ${t.authorizedByUserId} IS NOT NULL AND ${t.authorizedAt} IS NOT NULL)
      OR (${t.status} = 'expired')`,
  ),
  expiryIndex: index("dak_pairing_intents_expires_at_idx").on(t.expiresAt),
}));

export const dakPairings = pgTable("dak_pairings", {
  id: uuid("id").primaryKey().defaultRandom(),
  pairingIntentId: uuid("pairing_intent_id").notNull().unique().references(() => dakPairingIntents.id, { onDelete: "restrict" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  tokenHash: text("token_hash").notNull().unique(),
  /** The only scopes currently issued by the pairing flow. */
  scopes: text("scopes").array().notNull(),
  /** A snapshot limits a credential to the events visible at authorization time. "*" is super-admin only. */
  seasonIds: text("season_ids").array().notNull(),
  status: dakPairingStatusEnum("status").notNull().default("active"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  activeShape: check(
    "dak_pairings_status_shape_check",
    sql`(${t.status} = 'active' AND ${t.revokedAt} IS NULL) OR (${t.status} = 'revoked' AND ${t.revokedAt} IS NOT NULL)`,
  ),
  userIndex: index("dak_pairings_user_id_idx").on(t.userId),
}));

/** Immutable submitted V1 artifact plus its mutable workflow projection. */
export const matchDemoImports = pgTable("match_demo_imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  seasonId: uuid("season_id").notNull(),
  matchId: uuid("match_id").notNull().references(() => matches.id, { onDelete: "restrict" }),
  matchMapId: uuid("match_map_id").notNull().references(() => matchMaps.id, { onDelete: "restrict" }),
  stageKey: text("stage_key").notNull(),
  stageRunId: uuid("stage_run_id"),
  demoSha256: text("demo_sha256").notNull(),
  payloadSha256: text("payload_sha256").notNull(),
  contractVersion: text("contract_version").notNull(),
  semanticProfile: text("semantic_profile").notNull(),
  analysisVersion: text("analysis_version").notNull(),
  evidenceRevision: text("evidence_revision").notNull(),
  status: matchDemoImportStatusEnum("status").notNull().default("pending"),
  /** Stored as submitted; no later code path is allowed to rewrite the artifact. */
  payload: jsonb("payload").notNull(),
  submittedByPairingId: uuid("submitted_by_pairing_id").notNull().references(() => dakPairings.id, { onDelete: "restrict" }),
  idempotencyKey: text("idempotency_key"),
  supersedesImportId: uuid("supersedes_import_id"),
  issues: jsonb("issues").$type<readonly { code: string; path?: string; message: string }[]>().notNull().default(sql`'[]'::jsonb`),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  payloadIdentity: unique("match_demo_imports_map_payload_unique").on(t.matchMapId, t.payloadSha256),
  idempotencyIdentity: uniqueIndex("match_demo_imports_idempotency_key_unique").on(t.idempotencyKey).where(sql`${t.idempotencyKey} IS NOT NULL`),
  mapIndex: index("match_demo_imports_map_created_at_idx").on(t.matchMapId, t.createdAt),
  seasonIndex: index("match_demo_imports_season_status_idx").on(t.seasonId, t.status),
  shaShape: check("match_demo_imports_sha_shape_check", sql`${t.demoSha256} ~ '^[a-f0-9]{64}$' AND ${t.payloadSha256} ~ '^[a-f0-9]{64}$'`),
  contractShape: check("match_demo_imports_contract_shape_check", sql`${t.contractVersion} = 'rivalhub-demo-evidence/1'`),
}));

/** Relational projection of confirmed source rounds; semantic per-player facts remain in the artifact for V1. */
export const matchRoundFacts = pgTable("match_round_facts", {
  id: uuid("id").primaryKey().defaultRandom(),
  importId: uuid("import_id").notNull().references(() => matchDemoImports.id, { onDelete: "cascade" }),
  roundSeq: integer("round_seq").notNull(),
  sourceRoundNumber: integer("source_round_number").notNull(),
  phase: demoRoundPhaseEnum("phase").notNull(),
  startTick: integer("start_tick").notNull(),
  freezeEndTick: integer("freeze_end_tick").notNull(),
  endTick: integer("end_tick").notNull(),
  teamASide: sideEnum("team_a_side").notNull(),
  teamBSide: sideEnum("team_b_side").notNull(),
  teamAScoreBefore: integer("team_a_score_before").notNull(),
  teamBScoreBefore: integer("team_b_score_before").notNull(),
  teamAEconomy: demoEconomyTypeEnum("team_a_economy").notNull(),
  teamBEconomy: demoEconomyTypeEnum("team_b_economy").notNull(),
  winnerTeamKey: text("winner_team_key").notNull(),
  winnerSide: sideEnum("winner_side").notNull(),
  endReason: text("end_reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  importRoundUnique: unique("match_round_facts_import_round_unique").on(t.importId, t.roundSeq),
  importIndex: index("match_round_facts_import_id_idx").on(t.importId),
  positiveRound: check("match_round_facts_positive_round_check", sql`${t.roundSeq} > 0 AND ${t.sourceRoundNumber} > 0`),
  nonNegativeTicks: check("match_round_facts_nonnegative_ticks_check", sql`${t.startTick} >= 0 AND ${t.freezeEndTick} >= 0 AND ${t.endTick} >= 0`),
  winnerShape: check("match_round_facts_winner_shape_check", sql`${t.winnerTeamKey} IN ('teamA', 'teamB')`),
}));

export type DakPairingIntent = typeof dakPairingIntents.$inferSelect;
export type DakPairing = typeof dakPairings.$inferSelect;
export type MatchDemoImport = typeof matchDemoImports.$inferSelect;
export type MatchRoundFact = typeof matchRoundFacts.$inferSelect;
