import { index, pgEnum, pgTable, text, timestamp, unique, uuid, boolean } from "drizzle-orm/pg-core";
import { users } from "./users";

export const institutionSourceEnum = pgEnum("institution_source", ["moe", "manual", "other_official"]);
export const academicStatusEnum = pgEnum("academic_status", ["enrolled", "graduated"]);
export const educationEvidenceTypeEnum = pgEnum("education_evidence_type", ["institutional_email", "chsi_enrollment_report", "chsi_education_report", "manual_other"]);
export const educationVerificationStatusEnum = pgEnum("education_verification_status", ["pending", "approved", "rejected"]);

/** Versioned canonical directory. MOE code is the external stable identifier. */
export const institutions = pgTable("institutions", {
  id: uuid("id").primaryKey().defaultRandom(),
  moeInstitutionCode: text("moe_institution_code").unique(),
  name: text("name").notNull(),
  province: text("province"),
  educationLevel: text("education_level"),
  category: text("category"),
  source: institutionSourceEnum("source").notNull(),
  sourceVersion: text("source_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ nameIndex: index("institutions_name_idx").on(t.name) }));

/** Only exact active domains may grant an automatic institutional verification. */
export const institutionEmailDomains = pgTable("institution_email_domains", {
  id: uuid("id").primaryKey().defaultRandom(),
  institutionId: uuid("institution_id").notNull().references(() => institutions.id),
  domain: text("domain").notNull(),
  credentialType: text("credential_type").notNull(),
  autoVerify: boolean("auto_verify").notNull().default(false),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uniqueDomain: unique("institution_email_domains_domain_unique").on(t.domain) }));

/** Immutable claim/evidence/review history; resubmission always creates a new row. */
export const educationVerifications = pgTable("education_verifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  institutionId: uuid("institution_id").notNull().references(() => institutions.id),
  academicStatus: academicStatusEnum("academic_status").notNull(),
  evidenceType: educationEvidenceTypeEnum("evidence_type").notNull(),
  /** CHSI online verification code; never expose outside the owner/admin review paths. */
  evidenceCode: text("evidence_code"),
  status: educationVerificationStatusEnum("status").notNull().default("pending"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userStatusIndex: index("education_verifications_user_status_idx").on(t.userId, t.status),
  institutionStatusIndex: index("education_verifications_institution_status_idx").on(t.institutionId, t.status),
}));
