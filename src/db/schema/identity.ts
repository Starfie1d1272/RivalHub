import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export const userIdentityKindEnum = pgEnum("user_identity_kind", ["email", "auth", "oauth", "external"]);
export const userIdentityStatusEnum = pgEnum("user_identity_status", ["active", "revoked", "retired"]);
export const userIdentityLinkProvenanceEnum = pgEnum("user_identity_link_provenance", [
  "signup_confirmation",
  "existing_account_reverification",
  "user_verified_link",
  "merge",
  "admin_migration",
]);
export const identityLinkRequestStatusEnum = pgEnum("identity_link_request_status", ["pending", "completed", "merge_required", "blocked", "cancelled"]);
export const userMergeEvidenceClassEnum = pgEnum("user_merge_evidence_class", ["dual_identity_control", "super_admin_review"]);
export const userMergeAuthorizationStatusEnum = pgEnum("user_merge_authorization_status", ["available", "consumed", "cancelled"]);

/** A credential or verified external identity bound to one canonical person. */
export const userIdentities = pgTable("user_identities", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  kind: userIdentityKindEnum("kind").notNull(),
  provider: text("provider").notNull(),
  providerSubject: text("provider_subject").notNull(),
  normalizedValue: text("normalized_value"),
  /** Null is retained for legacy primary credentials whose verification fact is unknown. */
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
  provenance: userIdentityLinkProvenanceEnum("provenance").notNull(),
  status: userIdentityStatusEnum("status").notNull().default("active"),
  isPrimary: boolean("is_primary").notNull().default(false),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
  retiredReason: text("retired_reason"),
}, (t) => ({
  activeProviderSubjectUnique: uniqueIndex("user_identities_active_provider_subject_unique")
    .on(t.provider, t.providerSubject)
    .where(sql`${t.status} = 'active'`),
  activeNormalizedValueUnique: uniqueIndex("user_identities_active_normalized_value_unique")
    .on(t.kind, t.normalizedValue)
    .where(sql`${t.status} = 'active' AND ${t.normalizedValue} IS NOT NULL`),
  onePrimaryPerKind: uniqueIndex("user_identities_one_primary_per_kind_unique")
    .on(t.userId, t.kind)
    .where(sql`${t.status} = 'active' AND ${t.isPrimary} = true`),
  userStatusIndex: index("user_identities_user_status_idx").on(t.userId, t.status),
  statusShape: check(
    "user_identities_status_shape_check",
    sql`(${t.status} = 'active' AND ${t.retiredAt} IS NULL AND ${t.retiredReason} IS NULL)
      OR (${t.status} <> 'active' AND ${t.isPrimary} = false AND ${t.retiredAt} IS NOT NULL AND length(trim(${t.retiredReason})) > 0)`,
  ),
  nonBlankProvider: check("user_identities_provider_non_blank_check", sql`length(trim(${t.provider})) > 0`),
  nonBlankSubject: check("user_identities_subject_non_blank_check", sql`length(trim(${t.providerSubject})) > 0`),
}));

/** One-time proof request. Only the hash of the browser state token is stored. */
export const identityLinkRequests = pgTable("identity_link_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  normalizedEmail: text("normalized_email").notNull(),
  stateTokenHash: text("state_token_hash").notNull(),
  status: identityLinkRequestStatusEnum("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  stateTokenUnique: unique("identity_link_requests_state_token_hash_unique").on(t.stateTokenHash),
  userStatusIndex: index("identity_link_requests_user_status_idx").on(t.userId, t.status),
  statusShape: check(
    "identity_link_requests_status_shape_check",
    sql`(${t.status} = 'pending' AND ${t.completedAt} IS NULL)
      OR (${t.status} <> 'pending' AND ${t.completedAt} IS NOT NULL)`,
  ),
}));

/** Short-lived authorization proving the current session and a second verified identity. */
export const userMergeAuthorizations = pgTable("user_merge_authorizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  initiatingUserId: uuid("initiating_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  counterpartyUserId: uuid("counterparty_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  provenIdentityId: uuid("proven_identity_id").notNull().references(() => userIdentities.id, { onDelete: "restrict" }),
  status: userMergeAuthorizationStatusEnum("status").notNull().default("available"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  initiatingStatusIndex: index("user_merge_authorizations_initiating_status_idx").on(t.initiatingUserId, t.status),
  statusShape: check(
    "user_merge_authorizations_status_shape_check",
    sql`(${t.status} = 'available' AND ${t.consumedAt} IS NULL)
      OR (${t.status} <> 'available' AND ${t.consumedAt} IS NOT NULL)`,
  ),
  distinctUsers: check("user_merge_authorizations_distinct_users_check", sql`${t.initiatingUserId} <> ${t.counterpartyUserId}`),
}));

/** Durable old-user -> canonical-user alias and merge audit fact. */
export const userMergeLedger = pgTable("user_merge_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  canonicalUserId: uuid("canonical_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  mergedUserId: uuid("merged_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  executedByUserId: uuid("executed_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  evidenceClass: userMergeEvidenceClassEnum("evidence_class").notNull(),
  reason: text("reason").notNull(),
  planFingerprint: text("plan_fingerprint").notNull(),
  authorizationId: uuid("authorization_id").references(() => userMergeAuthorizations.id, { onDelete: "restrict" }),
  domainSummary: jsonb("domain_summary").$type<Record<string, number>>().notNull(),
  mergedAt: timestamp("merged_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  mergedUserUnique: unique("user_merge_ledger_merged_user_id_unique").on(t.mergedUserId),
  authorizationUnique: unique("user_merge_ledger_authorization_id_unique").on(t.authorizationId),
  canonicalIndex: index("user_merge_ledger_canonical_user_id_idx").on(t.canonicalUserId),
  distinctUsers: check("user_merge_ledger_distinct_users_check", sql`${t.canonicalUserId} <> ${t.mergedUserId}`),
  nonBlankReason: check("user_merge_ledger_reason_non_blank_check", sql`length(trim(${t.reason})) > 0`),
  fingerprintShape: check("user_merge_ledger_fingerprint_shape_check", sql`${t.planFingerprint} ~ '^[a-f0-9]{64}$'`),
}));

export type UserIdentity = typeof userIdentities.$inferSelect;
export type UserMergeLedgerEntry = typeof userMergeLedger.$inferSelect;
