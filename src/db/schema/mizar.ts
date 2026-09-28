import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, integer, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { seasons } from "./seasons";
import { matches } from "./matches";

export const mizarInstallations = pgTable("mizar_installations", {
  id: uuid("id").defaultRandom().primaryKey(),
  competitionId: uuid("competition_id").notNull().references(() => seasons.id),
  displayName: text("display_name").notNull(),
  credentialHash: text("credential_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const mizarPairings = pgTable("mizar_pairings", {
  id: uuid("id").defaultRandom().primaryKey(),
  competitionId: uuid("competition_id").notNull().references(() => seasons.id),
  codeHash: text("code_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
});

// Low-frequency authority and reliable continuity only. No live frame columns.
export const matchLiveSessions = pgTable("match_live_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  matchId: uuid("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
  installationId: uuid("installation_id").notNull().references(() => mizarInstallations.id),
  producerInstanceId: text("producer_instance_id").notNull(),
  liveSessionId: text("live_session_id").notNull(),
  contextRevision: text("context_revision").notNull(),
  authorityRevision: integer("authority_revision").notNull(),
  programSourceGeneration: integer("program_source_generation").notNull(),
  mapEpoch: integer("map_epoch").notNull(),
  lastReliableSeq: integer("last_reliable_seq").notNull().default(-1),
  lastReliableEventAt: timestamp("last_reliable_event_at", { withTimezone: true }),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  closeReason: text("close_reason"),
  identityHealth: text("identity_health").notNull().default("unknown"),
  lineupHealth: text("lineup_health").notNull().default("unknown"),
  continuityHealth: text("continuity_health").notNull().default("unknown"),
  autoCanonicalizationArmed: boolean("auto_canonicalization_armed").notNull().default(false),
  manualTakeoverMapEpoch: integer("manual_takeover_map_epoch"),
  currentMapId: uuid("current_map_id"),
  mapExecutionPhase: text("map_execution_phase").notNull().default("waiting"),
}, t => [uniqueIndex("match_one_active_live_source").on(t.matchId).where(sql`${t.closedAt} IS NULL`)]);

export const mizarReliableReceipts = pgTable("mizar_reliable_receipts", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id").notNull().references(() => matchLiveSessions.id, { onDelete: "cascade" }),
  idempotencyKey: text("idempotency_key").notNull(),
  eventHash: text("event_hash").notNull(),
  kind: text("kind").notNull(),
  outcome: text("outcome").notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("mizar_reliable_receipt_dedupe").on(t.sessionId, t.idempotencyKey)]);
