import { normalizeEmail } from "../utils/email";

export const AUTH_CONSISTENCY_GRACE_WINDOW_MS = 24 * 60 * 60 * 1000;

export const AUTH_CONSISTENCY_CLASSIFICATIONS = [
  "consistent",
  "pending_signup",
  "stale_auth_orphan",
  "public_without_auth",
  "identity_owner_conflict",
] as const;

export type AuthConsistencyClassification = typeof AUTH_CONSISTENCY_CLASSIFICATIONS[number];
export type AuthConsistencySeverity = "none" | "warning" | "high" | "critical";
export type AuthConsistencyHealability = "not_needed" | "safe_self_heal" | "manual_review" | "blocked";
export type AuthConsistencyRepairCode = "create_canonical_user" | "bind_existing_canonical";

export interface AuthConsistencyAuthUser {
  id: string;
  email: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
  lastSignInAt: Date | null;
}

export interface AuthConsistencyCanonicalUser {
  id: string;
  authId: string | null;
  email: string;
  createdAt: Date;
}

export interface AuthConsistencyIdentity {
  id: string;
  userId: string;
  kind: string;
  provider: string;
  providerSubject: string;
  normalizedValue: string | null;
  verifiedAt: Date | null;
  isPrimary: boolean;
}

export interface AuthConsistencyIdentityOwnership {
  identityIds: string[];
  identityOwnerIds: string[];
  authSubjectOwnerIds: string[];
  normalizedEmailOwnerIds: string[];
  legacyAuthIdOwnerIds: string[];
  legacyEmailOwnerIds: string[];
  matchedAuthUserIds: string[];
}

export interface AuthConsistencyRecord {
  classification: AuthConsistencyClassification;
  severity: AuthConsistencySeverity;
  authUserId: string | null;
  canonicalUserId: string | null;
  createdAt: Date | null;
  confirmedAt: Date | null;
  lastSignInAt: Date | null;
  identityOwnership: AuthConsistencyIdentityOwnership;
  healability: AuthConsistencyHealability;
  repairCode: AuthConsistencyRepairCode | null;
  blockerCode: string | null;
  conflictCode: string | null;
}

export interface AuthConsistencyReportInput {
  authUsers: readonly AuthConsistencyAuthUser[];
  canonicalUsers: readonly AuthConsistencyCanonicalUser[];
  identities: readonly AuthConsistencyIdentity[];
}

export interface AuthConsistencyReportOptions {
  now: Date;
  graceWindowMs?: number;
}

export interface AuthConsistencyRepairPlan {
  authUserId: string;
  classification: AuthConsistencyClassification | null;
  action: AuthConsistencyRepairCode | null;
  canonicalUserId: string | null;
  verifiedAt: Date | null;
  executable: boolean;
  blockerCode: string | null;
  conflictCode: string | null;
}

type OwnerIndex = Map<string, Set<string>>;

/**
 * Classify a point-in-time Auth/public reconciliation without reading or
 * writing either system. Callers must provide the observation time so the
 * signup grace-window decision remains deterministic.
 */
export function buildAuthConsistencyReport(
  input: AuthConsistencyReportInput,
  options: AuthConsistencyReportOptions,
): AuthConsistencyRecord[] {
  assertValidDate(options.now, "now");
  const graceWindowMs = options.graceWindowMs ?? AUTH_CONSISTENCY_GRACE_WINDOW_MS;
  if (!Number.isFinite(graceWindowMs) || graceWindowMs < 0) {
    throw new Error("Auth consistency grace window 必须是非负有限毫秒数。");
  }

  const activeCanonicalIds = new Set(input.canonicalUsers.map((user) => user.id));
  const authById = new Map(input.authUsers.map((user) => [user.id, user]));
  const authByEmail = buildAuthEmailIndex(input.authUsers);
  const legacyAuthIdOwners = buildCanonicalIndex(input.canonicalUsers, (user) => user.authId);
  const legacyEmailOwners = buildCanonicalIndex(input.canonicalUsers, (user) => normalizeEmail(user.email));
  const identityByAuthSubject = buildIdentityIndex(
    input.identities,
    (identity) => identity.provider === "supabase_auth" ? identity.providerSubject : null,
  );
  const identityByNormalizedValue = buildIdentityIndex(
    input.identities,
    (identity) => identity.normalizedValue ? normalizeEmail(identity.normalizedValue) : null,
  );
  const identitiesByUser = groupBy(input.identities, (identity) => identity.userId);

  const authRecords = input.authUsers.map((authUser) => {
    const emailKey = authUser.email ? normalizeEmail(authUser.email) : null;
    const matchedIdentities = input.identities.filter((identity) =>
      (identity.provider === "supabase_auth" && identity.providerSubject === authUser.id) ||
      (emailKey !== null && identity.normalizedValue !== null && normalizeEmail(identity.normalizedValue) === emailKey),
    );
    const identityOwnerIds = uniqueSorted(matchedIdentities.map((identity) => identity.userId));
    const authSubjectOwnerIds = uniqueSorted(identityByAuthSubject.get(authUser.id) ?? []);
    const normalizedEmailOwnerIds = emailKey ? uniqueSorted(identityByNormalizedValue.get(emailKey) ?? []) : [];
    const legacyAuthIdOwnerIds = uniqueSorted(legacyAuthIdOwners.get(authUser.id) ?? []);
    const legacyEmailOwnerIds = emailKey ? uniqueSorted(legacyEmailOwners.get(emailKey) ?? []) : [];
    const ownerIds = uniqueSorted([
      ...identityOwnerIds,
      ...legacyAuthIdOwnerIds,
      ...legacyEmailOwnerIds,
    ]);
    const conflictCode = findConflictCode({
      activeCanonicalIds,
      ownerIds,
      identityOwnerIds,
      authSubjectOwnerIds,
      normalizedEmailOwnerIds,
      legacyAuthIdOwnerIds,
      legacyEmailOwnerIds,
    });
    const ownership: AuthConsistencyIdentityOwnership = {
      identityIds: uniqueSorted(matchedIdentities.map((identity) => identity.id)),
      identityOwnerIds,
      authSubjectOwnerIds,
      normalizedEmailOwnerIds,
      legacyAuthIdOwnerIds,
      legacyEmailOwnerIds,
      matchedAuthUserIds: [authUser.id],
    };

    if (conflictCode) {
      return createRecord({
        classification: "identity_owner_conflict",
        severity: "critical",
        authUser,
        canonicalUserId: null,
        ownership,
        healability: "blocked",
        repairCode: null,
        blockerCode: null,
        conflictCode,
      });
    }

    const canonicalUserId = ownerIds[0] ?? null;
    if (canonicalUserId) {
      const hasDirectAuthBinding = authSubjectOwnerIds.includes(canonicalUserId) || legacyAuthIdOwnerIds.includes(canonicalUserId);
      if (hasDirectAuthBinding) {
        return createRecord({
          classification: "consistent",
          severity: "none",
          authUser,
          canonicalUserId,
          ownership,
          healability: "not_needed",
          repairCode: null,
          blockerCode: null,
          conflictCode: null,
        });
      }

      return createRecord({
        classification: "consistent",
        severity: "none",
        authUser,
        canonicalUserId,
        ownership,
        healability: authUser.confirmedAt ? "safe_self_heal" : "blocked",
        repairCode: "bind_existing_canonical",
        blockerCode: authUser.confirmedAt ? null : "auth_email_unconfirmed",
        conflictCode: null,
      });
    }

    const ageMs = Math.max(0, options.now.getTime() - authUser.createdAt.getTime());
    if (!authUser.confirmedAt && ageMs <= graceWindowMs) {
      return createRecord({
        classification: "pending_signup",
        severity: "none",
        authUser,
        canonicalUserId: null,
        ownership,
        healability: "not_needed",
        repairCode: null,
        blockerCode: null,
        conflictCode: null,
      });
    }

    const staleBlockerCode = !authUser.email
      ? "auth_email_missing"
      : !authUser.confirmedAt
        ? "auth_confirmation_missing"
        : null;
    return createRecord({
      classification: "stale_auth_orphan",
      severity: "warning",
      authUser,
      canonicalUserId: null,
      ownership,
      healability: staleBlockerCode ? "blocked" : "safe_self_heal",
      repairCode: staleBlockerCode ? null : "create_canonical_user",
      blockerCode: staleBlockerCode,
      conflictCode: null,
    });
  });

  const records: AuthConsistencyRecord[] = [...authRecords];
  const authRecordById = new Map(authRecords.map((record) => [record.authUserId, record]));

  for (const canonicalUser of input.canonicalUsers) {
    const emailKey = normalizeEmail(canonicalUser.email);
    const userIdentities = identitiesByUser.get(canonicalUser.id) ?? [];
    const authIdentities = userIdentities.filter((identity) => identity.provider === "supabase_auth");
    const candidateAuthUsers = uniqueAuthUsers([
      canonicalUser.authId ? authById.get(canonicalUser.authId) : undefined,
      ...authIdentities.map((identity) => authById.get(identity.providerSubject)),
      ...(authByEmail.get(emailKey) ?? []),
    ]);
    const hasValidAuthIdentity = authIdentities.some((identity) => authById.has(identity.providerSubject));
    const hasResolvableEmailOwner = candidateAuthUsers.some((authUser) => {
      const record = authRecordById.get(authUser.id);
      return record?.classification === "consistent" && record.canonicalUserId === canonicalUser.id;
    });
    const hasMissingLegacyAuthId = canonicalUser.authId !== null && !authById.has(canonicalUser.authId);
    const hasMissingAuthIdentity = authIdentities.some((identity) => !authById.has(identity.providerSubject));
    if (!hasMissingLegacyAuthId && !hasMissingAuthIdentity && (hasValidAuthIdentity || hasResolvableEmailOwner)) continue;

    const identityRows = uniqueIdentities([
      ...userIdentities,
      ...input.identities.filter((identity) => identity.normalizedValue !== null && normalizeEmail(identity.normalizedValue) === emailKey),
    ]);
    const ownership: AuthConsistencyIdentityOwnership = {
      identityIds: uniqueSorted(identityRows.map((identity) => identity.id)),
      identityOwnerIds: uniqueSorted(identityRows.map((identity) => identity.userId)),
      authSubjectOwnerIds: uniqueSorted(authIdentities.map((identity) => identity.userId)),
      normalizedEmailOwnerIds: uniqueSorted(identityByNormalizedValue.get(emailKey) ?? []),
      legacyAuthIdOwnerIds: canonicalUser.authId ? uniqueSorted(legacyAuthIdOwners.get(canonicalUser.authId) ?? []) : [],
      legacyEmailOwnerIds: uniqueSorted(legacyEmailOwners.get(emailKey) ?? []),
      matchedAuthUserIds: candidateAuthUsers.map((authUser) => authUser.id).sort(),
    };
    const blockerCode = hasMissingLegacyAuthId
      ? "auth_id_points_to_missing_auth_user"
      : hasMissingAuthIdentity
        ? "auth_identity_points_to_missing_auth_user"
        : "primary_auth_identity_missing";
    records.push({
      classification: "public_without_auth",
      severity: "high",
      authUserId: null,
      canonicalUserId: canonicalUser.id,
      createdAt: canonicalUser.createdAt,
      confirmedAt: null,
      lastSignInAt: null,
      identityOwnership: ownership,
      healability: "manual_review",
      repairCode: null,
      blockerCode,
      conflictCode: null,
    });
  }

  appendUnmatchedIdentityConflicts(records, input, authRecords, activeCanonicalIds, identityByAuthSubject, identityByNormalizedValue, authById, authByEmail);
  return records.sort(compareRecords);
}

export function summarizeAuthConsistencyReport(
  records: readonly AuthConsistencyRecord[],
): Record<AuthConsistencyClassification, number> {
  const summary = Object.fromEntries(AUTH_CONSISTENCY_CLASSIFICATIONS.map((classification) => [classification, 0])) as Record<AuthConsistencyClassification, number>;
  for (const record of records) summary[record.classification] += 1;
  return summary;
}

export function buildAuthConsistencyRepairPlan(
  record: AuthConsistencyRecord | undefined,
  authUser: AuthConsistencyAuthUser | undefined,
): AuthConsistencyRepairPlan {
  if (!record || !authUser) {
    return {
      authUserId: authUser?.id ?? record?.authUserId ?? "",
      classification: record?.classification ?? null,
      action: null,
      canonicalUserId: null,
      verifiedAt: null,
      executable: false,
      blockerCode: "auth_user_not_found",
      conflictCode: null,
    };
  }

  const blocked = (blockerCode: string | null, conflictCode: string | null): AuthConsistencyRepairPlan => ({
    authUserId: authUser.id,
    classification: record.classification,
    action: null,
    canonicalUserId: record.canonicalUserId,
    verifiedAt: record.confirmedAt,
    executable: false,
    blockerCode,
    conflictCode,
  });

  if (record.authUserId !== authUser.id) return blocked("auth_record_mismatch", null);
  if (record.conflictCode) return blocked(null, record.conflictCode);
  if (record.healability !== "safe_self_heal" || !record.repairCode) {
    return blocked(record.blockerCode ?? "repair_not_allowed", null);
  }
  if (!authUser.email) return blocked("auth_email_missing", null);
  if (!record.confirmedAt) return blocked("auth_confirmation_missing", null);
  if (record.repairCode === "bind_existing_canonical" && !record.canonicalUserId) {
    return blocked("canonical_owner_missing", null);
  }

  return {
    authUserId: authUser.id,
    classification: record.classification,
    action: record.repairCode,
    canonicalUserId: record.canonicalUserId,
    verifiedAt: record.confirmedAt,
    executable: true,
    blockerCode: null,
    conflictCode: null,
  };
}

function appendUnmatchedIdentityConflicts(
  records: AuthConsistencyRecord[],
  input: AuthConsistencyReportInput,
  authRecords: readonly AuthConsistencyRecord[],
  activeCanonicalIds: ReadonlySet<string>,
  identityByAuthSubject: OwnerIndex,
  identityByNormalizedValue: OwnerIndex,
  authById: ReadonlyMap<string, AuthConsistencyAuthUser>,
  authByEmail: ReadonlyMap<string, AuthConsistencyAuthUser[]>,
): void {
  const reportedIdentityIds = new Set(authRecords
    .filter((record) => record.classification === "identity_owner_conflict")
    .flatMap((record) => record.identityOwnership.identityIds));
  const reportedConflictKeys = new Set<string>();
  for (const identity of input.identities) {
    if (!activeCanonicalIds.has(identity.userId) && !reportedIdentityIds.has(identity.id)) {
      const key = `identity:${identity.id}`;
      if (reportedConflictKeys.has(key)) continue;
      reportedConflictKeys.add(key);
      records.push(createSyntheticConflictRecord(
        [identity],
        "identity_owner_missing_active_canonical",
        authById.get(identity.providerSubject)?.id ?? null,
      ));
    }
  }
  appendDuplicateIdentityConflicts(
    records,
    input,
    reportedIdentityIds,
    reportedConflictKeys,
    identityByAuthSubject,
    (identity) => identity.provider === "supabase_auth" ? identity.providerSubject : null,
    (subject) => authById.get(subject)?.id ?? null,
    "multiple_canonical_owners_for_auth_subject",
  );
  appendDuplicateIdentityConflicts(
    records,
    input,
    reportedIdentityIds,
    reportedConflictKeys,
    identityByNormalizedValue,
    (identity) => identity.normalizedValue ? normalizeEmail(identity.normalizedValue) : null,
    (email) => authByEmail.get(email)?.[0]?.id ?? null,
    "multiple_canonical_owners_for_normalized_email",
  );
}

function appendDuplicateIdentityConflicts(
  records: AuthConsistencyRecord[],
  input: AuthConsistencyReportInput,
  reportedIdentityIds: ReadonlySet<string>,
  reportedConflictKeys: Set<string>,
  index: OwnerIndex,
  identityKeyFor: (identity: AuthConsistencyIdentity) => string | null,
  matchedAuthUserId: (key: string) => string | null,
  conflictCode: string,
): void {
  for (const [key, ownerIds] of index.entries()) {
    if (ownerIds.size < 2) continue;
    const identityRows = input.identities.filter((identity) => identityKeyFor(identity) === key && !reportedIdentityIds.has(identity.id));
    if (identityRows.length === 0) continue;
    const conflictKey = `${conflictCode}:${key}`;
    if (reportedConflictKeys.has(conflictKey)) continue;
    reportedConflictKeys.add(conflictKey);
    records.push(createSyntheticConflictRecord(identityRows, conflictCode, matchedAuthUserId(key)));
  }
}

function createSyntheticConflictRecord(
  identities: readonly AuthConsistencyIdentity[],
  conflictCode: string,
  authUserId: string | null,
): AuthConsistencyRecord {
  return {
    classification: "identity_owner_conflict",
    severity: "critical",
    authUserId,
    canonicalUserId: null,
    createdAt: null,
    confirmedAt: null,
    lastSignInAt: null,
    identityOwnership: {
      identityIds: uniqueSorted(identities.map((identity) => identity.id)),
      identityOwnerIds: uniqueSorted(identities.map((identity) => identity.userId)),
      authSubjectOwnerIds: uniqueSorted(identities.filter((identity) => identity.provider === "supabase_auth").map((identity) => identity.userId)),
      normalizedEmailOwnerIds: uniqueSorted(identities.filter((identity) => identity.normalizedValue !== null).map((identity) => identity.userId)),
      legacyAuthIdOwnerIds: [],
      legacyEmailOwnerIds: [],
      matchedAuthUserIds: authUserId ? [authUserId] : [],
    },
    healability: "blocked",
    repairCode: null,
    blockerCode: null,
    conflictCode,
  };
}

function findConflictCode(input: {
  activeCanonicalIds: ReadonlySet<string>;
  ownerIds: readonly string[];
  identityOwnerIds: readonly string[];
  authSubjectOwnerIds: readonly string[];
  normalizedEmailOwnerIds: readonly string[];
  legacyAuthIdOwnerIds: readonly string[];
  legacyEmailOwnerIds: readonly string[];
}): string | null {
  if (input.identityOwnerIds.some((ownerId) => !input.activeCanonicalIds.has(ownerId))) {
    return "identity_owner_missing_active_canonical";
  }
  if (input.authSubjectOwnerIds.length > 1) return "multiple_canonical_owners_for_auth_subject";
  if (input.normalizedEmailOwnerIds.length > 1) return "multiple_canonical_owners_for_normalized_email";
  if (input.legacyAuthIdOwnerIds.length > 1) return "multiple_canonical_owners_for_legacy_auth_id";
  if (input.legacyEmailOwnerIds.length > 1) return "multiple_canonical_owners_for_legacy_email";

  const sourceOwners = uniqueSorted([
    ...input.authSubjectOwnerIds,
    ...input.normalizedEmailOwnerIds,
    ...input.legacyAuthIdOwnerIds,
    ...input.legacyEmailOwnerIds,
  ]);
  if (sourceOwners.length > 1 || input.ownerIds.length > 1) return "auth_and_email_owner_mismatch";
  return null;
}

function createRecord(input: {
  classification: AuthConsistencyClassification;
  severity: AuthConsistencySeverity;
  authUser: AuthConsistencyAuthUser;
  canonicalUserId: string | null;
  ownership: AuthConsistencyIdentityOwnership;
  healability: AuthConsistencyHealability;
  repairCode: AuthConsistencyRepairCode | null;
  blockerCode: string | null;
  conflictCode: string | null;
}): AuthConsistencyRecord {
  return {
    classification: input.classification,
    severity: input.severity,
    authUserId: input.authUser.id,
    canonicalUserId: input.canonicalUserId,
    createdAt: input.authUser.createdAt,
    confirmedAt: input.authUser.confirmedAt,
    lastSignInAt: input.authUser.lastSignInAt,
    identityOwnership: input.ownership,
    healability: input.healability,
    repairCode: input.repairCode,
    blockerCode: input.blockerCode,
    conflictCode: input.conflictCode,
  };
}

function buildAuthEmailIndex(authUsers: readonly AuthConsistencyAuthUser[]): Map<string, AuthConsistencyAuthUser[]> {
  const index = new Map<string, AuthConsistencyAuthUser[]>();
  for (const authUser of authUsers) {
    if (!authUser.email) continue;
    const key = normalizeEmail(authUser.email);
    const values = index.get(key) ?? [];
    values.push(authUser);
    index.set(key, values);
  }
  return index;
}

function buildCanonicalIndex(
  users: readonly AuthConsistencyCanonicalUser[],
  keyFor: (user: AuthConsistencyCanonicalUser) => string | null,
): OwnerIndex {
  const index: OwnerIndex = new Map();
  for (const user of users) {
    const key = keyFor(user);
    if (!key) continue;
    const owners = index.get(key) ?? new Set<string>();
    owners.add(user.id);
    index.set(key, owners);
  }
  return index;
}

function buildIdentityIndex(
  identities: readonly AuthConsistencyIdentity[],
  keyFor: (identity: AuthConsistencyIdentity) => string | null,
): OwnerIndex {
  const index: OwnerIndex = new Map();
  for (const identity of identities) {
    const key = keyFor(identity);
    if (!key) continue;
    const owners = index.get(key) ?? new Set<string>();
    owners.add(identity.userId);
    index.set(key, owners);
  }
  return index;
}

function groupBy<T>(values: readonly T[], keyFor: (value: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const value of values) {
    const key = keyFor(value);
    const group = result.get(key) ?? [];
    group.push(value);
    result.set(key, group);
  }
  return result;
}

function uniqueAuthUsers(users: readonly (AuthConsistencyAuthUser | undefined)[]): AuthConsistencyAuthUser[] {
  const seen = new Set<string>();
  return users.flatMap((user) => {
    if (!user || seen.has(user.id)) return [];
    seen.add(user.id);
    return [user];
  });
}

function uniqueIdentities(identities: readonly AuthConsistencyIdentity[]): AuthConsistencyIdentity[] {
  const seen = new Set<string>();
  return identities.flatMap((identity) => {
    if (seen.has(identity.id)) return [];
    seen.add(identity.id);
    return [identity];
  });
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function assertValidDate(value: Date, name: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error(`Auth consistency ${name} 必须是有效 Date。`);
}

function compareRecords(left: AuthConsistencyRecord, right: AuthConsistencyRecord): number {
  return (left.authUserId ?? "").localeCompare(right.authUserId ?? "") ||
    (left.canonicalUserId ?? "").localeCompare(right.canonicalUserId ?? "") ||
    left.classification.localeCompare(right.classification);
}
