import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, type DB, type TxDb } from "@/db/client";
import { auditLogs, conversionPolicies, seasons, users } from "@/db/schema";
import { getDisplayName } from "@/lib/identity/display-name";
import { AppError, ErrorCode } from "@/lib/errors";
import { normalizeTeamRegistrationConfig } from "@/lib/seasons/compatibility";
import type { TeamRegistrationConfig } from "@/types/season";
import {
  validateConversionPolicyMapping,
  type ConversionPolicyMapping,
} from "@/lib/competitive/conversion-policy";

export type ConversionPolicyDatabaseExecutor = DB | TxDb;

export interface ConversionPolicyEventReference {
  seasonId: string;
  seasonName: string;
  seasonSlug: string;
  seasonStatus: typeof seasons.$inferSelect.status;
  policyId: string;
  policyVersion: string | null;
  registrationOpenedAt: Date | null;
  referenceState: "published_locked" | "registration_frozen";
}

export interface ConversionPolicyAdminRow {
  id: string;
  sourcePlatform: string;
  targetPlatform: string;
  version: string;
  status: "draft" | "approved" | "retired";
  mapping: ConversionPolicyMapping;
  isCurrent: boolean;
  sourceNote: string | null;
  rationale: string | null;
  changeSummary: string | null;
  internalNote: string | null;
  approvedAt: Date | null;
  approvedBy: string | null;
  approvedByLabel: string | null;
  createdAt: Date;
  updatedAt: Date;
  eventReferences: ConversionPolicyEventReference[];
}

export interface ConversionPolicyProvenance {
  id: string;
  version: string | null;
  sourceNote: string | null;
  rationale: string | null;
  changeSummary: string | null;
}

export interface ConversionPolicyDraftInput {
  basePolicyId: string;
  version: string;
  sourceNote?: string | null;
  rationale?: string | null;
  changeSummary?: string | null;
  internalNote?: string | null;
}

export interface ConversionPolicyDraftUpdateInput {
  id: string;
  mapping: ConversionPolicyMapping;
  sourceNote?: string | null;
  rationale?: string | null;
  changeSummary?: string | null;
  internalNote?: string | null;
}

const SUPPORTED_SOURCE_PLATFORM = "fivee";
const SUPPORTED_TARGET_PLATFORM = "perfect_world";

function normalizedNote(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function requireValidMapping(mapping: unknown): asserts mapping is ConversionPolicyMapping {
  try {
    validateConversionPolicyMapping(mapping as ConversionPolicyMapping);
  } catch (error) {
    throw new AppError(
      ErrorCode.VALIDATION_FAILED,
      error instanceof Error ? error.message : "换算规则内容无效。",
    );
  }
}

function assertSupportedPair(sourcePlatform: string, targetPlatform: string): void {
  if (sourcePlatform !== SUPPORTED_SOURCE_PLATFORM || targetPlatform !== SUPPORTED_TARGET_PLATFORM) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "2.x 只支持运营 5E → Perfect World 换算策略。 ");
  }
}

function policyAuditMeta(policy: Pick<typeof conversionPolicies.$inferSelect, "id" | "version" | "sourcePlatform" | "targetPlatform">) {
  return {
    policyId: policy.id,
    version: policy.version,
    sourcePlatform: policy.sourcePlatform,
    targetPlatform: policy.targetPlatform,
  };
}

async function lockPolicy(tx: TxDb, id: string) {
  const [policy] = await tx.select().from(conversionPolicies).where(eq(conversionPolicies.id, id)).for("update");
  if (!policy) throw new AppError(ErrorCode.NOT_FOUND, "换算策略不存在。 ");
  return policy;
}

function extractReference(config: TeamRegistrationConfig | null | undefined): {
  policyId: string | null;
  policyVersion: string | null;
  fallbackVersion: string | null;
} {
  const profile = config?.competitiveProfile;
  if (!profile) return { policyId: null, policyVersion: null, fallbackVersion: null };
  const policyId = profile.conversionPolicyId?.trim() || null;
  const policyVersion = profile.conversionPolicyVersion?.trim() || null;
  const fallbackVersion = profile.fallbackConversion?.version?.trim() || null;
  return { policyId, policyVersion, fallbackVersion };
}

export function extractConversionPolicyReference(config: unknown): {
  conversionPolicyId: string | null;
  conversionPolicyVersion: string | null;
  fallbackConversionVersion: string | null;
} {
  const reference = extractReference(normalizeTeamRegistrationConfig(config as Partial<TeamRegistrationConfig> | null | undefined));
  return {
    conversionPolicyId: reference.policyId,
    conversionPolicyVersion: reference.policyVersion,
    fallbackConversionVersion: reference.fallbackVersion,
  };
}

function eventReferencesForPolicy(
  policyId: string,
  rows: Array<Pick<typeof seasons.$inferSelect, "id" | "name" | "slug" | "status" | "registrationOpenedAt" | "teamRegistrationConfig">>,
): ConversionPolicyEventReference[] {
  return rows.flatMap((season) => {
    const reference = extractReference(normalizeTeamRegistrationConfig(season.teamRegistrationConfig));
    if (reference.policyId !== policyId) return [];
    return [{
      seasonId: season.id,
      seasonName: season.name,
      seasonSlug: season.slug,
      seasonStatus: season.status,
      policyId,
      policyVersion: reference.policyVersion ?? reference.fallbackVersion,
      registrationOpenedAt: season.registrationOpenedAt,
      referenceState: season.registrationOpenedAt ? "registration_frozen" : "published_locked",
    } satisfies ConversionPolicyEventReference];
  });
}

/** Load the complete super-admin read model, including stable event references. */
export async function loadConversionPolicyAdminRows(
  executor: ConversionPolicyDatabaseExecutor = db,
): Promise<ConversionPolicyAdminRow[]> {
  const [policies, seasonRows] = await Promise.all([
    executor.select().from(conversionPolicies).where(and(
      eq(conversionPolicies.sourcePlatform, SUPPORTED_SOURCE_PLATFORM),
      eq(conversionPolicies.targetPlatform, SUPPORTED_TARGET_PLATFORM),
    )).orderBy(desc(conversionPolicies.createdAt), desc(conversionPolicies.version)),
    executor.select({
      id: seasons.id,
      name: seasons.name,
      slug: seasons.slug,
      status: seasons.status,
      registrationOpenedAt: seasons.registrationOpenedAt,
      teamRegistrationConfig: seasons.teamRegistrationConfig,
    }).from(seasons).orderBy(asc(seasons.name), asc(seasons.id)),
  ]);
  const approvedByIds = [...new Set(policies.map((policy) => policy.approvedBy).filter((id): id is string => Boolean(id)))];
  const approvers = approvedByIds.length === 0
    ? []
    : await executor.select({ id: users.id, email: users.email, displayName: users.displayName, perfectName: users.perfectName, steamName: users.steamName })
      .from(users)
      .where(inArray(users.id, approvedByIds));
  const approverLabels = new Map(approvers.map((user) => [user.id, getDisplayName(user)]));

  return policies.map((policy) => ({
    id: policy.id,
    sourcePlatform: policy.sourcePlatform,
    targetPlatform: policy.targetPlatform,
    version: policy.version,
    status: policy.status,
    mapping: policy.mapping,
    isCurrent: policy.isCurrent,
    sourceNote: policy.sourceNote,
    rationale: policy.rationale,
    changeSummary: policy.changeSummary,
    internalNote: policy.internalNote,
    approvedAt: policy.approvedAt,
    approvedBy: policy.approvedBy,
    approvedByLabel: policy.approvedBy ? approverLabels.get(policy.approvedBy) ?? policy.approvedBy : null,
    createdAt: policy.createdAt,
    updatedAt: policy.updatedAt,
    eventReferences: eventReferencesForPolicy(policy.id, seasonRows),
  }));
}

/** Read only the operator-safe provenance used by Season Settings. */
export async function loadConversionPolicyProvenance(
  executor: ConversionPolicyDatabaseExecutor,
  config: unknown,
): Promise<ConversionPolicyProvenance | null> {
  const reference = extractConversionPolicyReference(config);
  if (!reference.conversionPolicyId) return null;
  const [policy] = await executor.select({
    id: conversionPolicies.id,
    version: conversionPolicies.version,
    sourceNote: conversionPolicies.sourceNote,
    rationale: conversionPolicies.rationale,
    changeSummary: conversionPolicies.changeSummary,
  }).from(conversionPolicies).where(eq(conversionPolicies.id, reference.conversionPolicyId)).limit(1);
  return {
    id: reference.conversionPolicyId,
    version: policy?.version ?? reference.conversionPolicyVersion ?? reference.fallbackConversionVersion,
    sourceNote: policy?.sourceNote ?? null,
    rationale: policy?.rationale ?? null,
    changeSummary: policy?.changeSummary ?? null,
  };
}

export async function createConversionPolicyDraftInTx(
  tx: TxDb,
  input: ConversionPolicyDraftInput,
  actorId: string,
): Promise<{ id: string }> {
  const base = await lockPolicy(tx, input.basePolicyId);
  assertSupportedPair(base.sourcePlatform, base.targetPlatform);
  if (!base.status || base.status === "draft") throw new AppError(ErrorCode.VALIDATION_FAILED, "新草稿必须从已批准或已退役策略复制。 ");
  const version = input.version.trim();
  if (!version) throw new AppError(ErrorCode.VALIDATION_FAILED, "请填写新的策略版本。 ");
  const [duplicate] = await tx.select({ id: conversionPolicies.id }).from(conversionPolicies).where(and(
    eq(conversionPolicies.sourcePlatform, base.sourcePlatform),
    eq(conversionPolicies.targetPlatform, base.targetPlatform),
    eq(conversionPolicies.version, version),
  )).limit(1);
  if (duplicate) throw new AppError(ErrorCode.VALIDATION_FAILED, `策略版本 ${version} 已存在。`);
  const [created] = await tx.insert(conversionPolicies).values({
    sourcePlatform: base.sourcePlatform,
    targetPlatform: base.targetPlatform,
    version,
    status: "draft",
    mapping: base.mapping,
    sourceNote: input.sourceNote === undefined ? base.sourceNote : normalizedNote(input.sourceNote),
    rationale: input.rationale === undefined ? base.rationale : normalizedNote(input.rationale),
    changeSummary: input.changeSummary === undefined ? base.changeSummary : normalizedNote(input.changeSummary),
    internalNote: input.internalNote === undefined ? base.internalNote : normalizedNote(input.internalNote),
    isCurrent: false,
    approvedAt: null,
    approvedBy: null,
    updatedAt: new Date(),
  }).returning({ id: conversionPolicies.id });
  if (!created) throw new AppError(ErrorCode.INTERNAL_ERROR, "创建换算策略草稿失败。 ");
  await tx.insert(auditLogs).values({
    seasonId: null,
    action: "conversion_policy.create_draft",
    actorId,
    targetId: created.id,
    targetType: "conversion_policy",
    meta: { ...policyAuditMeta({ ...base, id: created.id, version }), clonedFromId: base.id },
  });
  return created;
}

export async function updateConversionPolicyDraftInTx(
  tx: TxDb,
  input: ConversionPolicyDraftUpdateInput,
  actorId: string,
): Promise<void> {
  const policy = await lockPolicy(tx, input.id);
  assertSupportedPair(policy.sourcePlatform, policy.targetPlatform);
  if (policy.status !== "draft") throw new AppError(ErrorCode.VALIDATION_FAILED, "只有草稿策略可以编辑。 ");
  requireValidMapping(input.mapping);
  await tx.update(conversionPolicies).set({
    mapping: input.mapping,
    ...(input.sourceNote === undefined ? {} : { sourceNote: normalizedNote(input.sourceNote) }),
    ...(input.rationale === undefined ? {} : { rationale: normalizedNote(input.rationale) }),
    ...(input.changeSummary === undefined ? {} : { changeSummary: normalizedNote(input.changeSummary) }),
    ...(input.internalNote === undefined ? {} : { internalNote: normalizedNote(input.internalNote) }),
    updatedAt: new Date(),
  }).where(eq(conversionPolicies.id, policy.id));
  await tx.insert(auditLogs).values({
    seasonId: null,
    action: "conversion_policy.update_draft",
    actorId,
    targetId: policy.id,
    targetType: "conversion_policy",
    meta: policyAuditMeta(policy),
  });
}

export async function approveConversionPolicyInTx(tx: TxDb, id: string, actorId: string): Promise<void> {
  const policy = await lockPolicy(tx, id);
  assertSupportedPair(policy.sourcePlatform, policy.targetPlatform);
  if (policy.status !== "draft") throw new AppError(ErrorCode.VALIDATION_FAILED, "只有草稿策略可以批准。 ");
  requireValidMapping(policy.mapping);
  if (!policy.sourceNote?.trim() || !policy.rationale?.trim()) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "批准策略前必须填写来源说明和采用理由。 ");
  }
  const approvedAt = new Date();
  await tx.update(conversionPolicies).set({
    status: "approved",
    isCurrent: false,
    approvedAt,
    approvedBy: actorId,
    updatedAt: approvedAt,
  }).where(eq(conversionPolicies.id, policy.id));
  await tx.insert(auditLogs).values({
    seasonId: null,
    action: "conversion_policy.approve",
    actorId,
    targetId: policy.id,
    targetType: "conversion_policy",
    meta: { ...policyAuditMeta(policy), approvedAt: approvedAt.toISOString() },
  });
}

export async function setCurrentConversionPolicyInTx(tx: TxDb, id: string, actorId: string): Promise<void> {
  const [candidate] = await tx.select({ sourcePlatform: conversionPolicies.sourcePlatform, targetPlatform: conversionPolicies.targetPlatform })
    .from(conversionPolicies)
    .where(eq(conversionPolicies.id, id))
    .limit(1);
  if (!candidate) throw new AppError(ErrorCode.NOT_FOUND, "换算策略不存在。 ");
  assertSupportedPair(candidate.sourcePlatform, candidate.targetPlatform);
  const pairPolicies = await tx.select({ id: conversionPolicies.id, version: conversionPolicies.version, isCurrent: conversionPolicies.isCurrent })
    .from(conversionPolicies)
    .where(and(eq(conversionPolicies.sourcePlatform, candidate.sourcePlatform), eq(conversionPolicies.targetPlatform, candidate.targetPlatform)))
    .orderBy(asc(conversionPolicies.id))
    .for("update");
  const policyIdentity = pairPolicies.find((row) => row.id === id);
  if (!policyIdentity) throw new AppError(ErrorCode.NOT_FOUND, "换算策略不存在。 ");
  if (policyIdentity.isCurrent) {
    const [currentPolicy] = await tx.select().from(conversionPolicies).where(eq(conversionPolicies.id, id)).limit(1);
    if (!currentPolicy) throw new AppError(ErrorCode.NOT_FOUND, "换算策略不存在。 ");
    if (currentPolicy.status !== "approved") throw new AppError(ErrorCode.VALIDATION_FAILED, "只有已批准策略可以设为当前版本。 ");
    return;
  }
  const [policy] = await tx.select().from(conversionPolicies).where(eq(conversionPolicies.id, id)).limit(1);
  if (!policy) throw new AppError(ErrorCode.NOT_FOUND, "换算策略不存在。 ");
  if (policy.status !== "approved") throw new AppError(ErrorCode.VALIDATION_FAILED, "只有已批准策略可以设为当前版本。 ");
  const previous = pairPolicies.find((row) => row.isCurrent);
  await tx.update(conversionPolicies).set({ isCurrent: false, updatedAt: new Date() }).where(and(
    eq(conversionPolicies.sourcePlatform, candidate.sourcePlatform),
    eq(conversionPolicies.targetPlatform, candidate.targetPlatform),
    eq(conversionPolicies.isCurrent, true),
  ));
  await tx.update(conversionPolicies).set({ isCurrent: true, updatedAt: new Date() }).where(eq(conversionPolicies.id, policy.id));
  await tx.insert(auditLogs).values({
    seasonId: null,
    action: "conversion_policy.set_current",
    actorId,
    targetId: policy.id,
    targetType: "conversion_policy",
    meta: { ...policyAuditMeta(policy), fromVersion: previous?.version ?? null, toVersion: policy.version },
  });
}

export async function retireConversionPolicyInTx(tx: TxDb, id: string, actorId: string): Promise<void> {
  const policy = await lockPolicy(tx, id);
  assertSupportedPair(policy.sourcePlatform, policy.targetPlatform);
  if (policy.status !== "approved") throw new AppError(ErrorCode.VALIDATION_FAILED, "只有已批准策略可以退役。 ");
  if (policy.isCurrent) throw new AppError(ErrorCode.VALIDATION_FAILED, "当前策略不能直接退役，请先切换当前版本。 ");
  await tx.update(conversionPolicies).set({ status: "retired", updatedAt: new Date() }).where(eq(conversionPolicies.id, policy.id));
  await tx.insert(auditLogs).values({
    seasonId: null,
    action: "conversion_policy.retire",
    actorId,
    targetId: policy.id,
    targetType: "conversion_policy",
    meta: policyAuditMeta(policy),
  });
}

export async function createConversionPolicyDraft(input: ConversionPolicyDraftInput, actorId: string): Promise<{ id: string }> {
  return db.transaction((tx) => createConversionPolicyDraftInTx(tx, input, actorId));
}

export async function updateConversionPolicyDraft(input: ConversionPolicyDraftUpdateInput, actorId: string): Promise<void> {
  return db.transaction((tx) => updateConversionPolicyDraftInTx(tx, input, actorId));
}

export async function approveConversionPolicy(id: string, actorId: string): Promise<void> {
  return db.transaction((tx) => approveConversionPolicyInTx(tx, id, actorId));
}

export async function setCurrentConversionPolicy(id: string, actorId: string): Promise<void> {
  return db.transaction((tx) => setCurrentConversionPolicyInTx(tx, id, actorId));
}

export async function retireConversionPolicy(id: string, actorId: string): Promise<void> {
  return db.transaction((tx) => retireConversionPolicyInTx(tx, id, actorId));
}
