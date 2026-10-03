import "server-only";
import { assertFreshAuthenticationInTx } from "@/lib/auth/session-registry";

import { and, eq, or, sql } from "drizzle-orm";
import type { DB, TxDb } from "@/db/client";
import { userIdentities, users } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { identityAppError } from "@/lib/identity/errors";
import { normalizeEmail } from "@/lib/utils/email";

type IdentityQueryable = Pick<DB, "select">;
type VerificationSource = "signup_confirmation" | "existing_account_reverification" | "admin_migration";

export async function resolveCanonicalUserId(
  queryable: IdentityQueryable,
  userId: string,
): Promise<string | null> {
  let currentId = userId;
  const visited = new Set<string>();

  for (let depth = 0; depth < 16; depth += 1) {
    if (visited.has(currentId)) throw new AppError(ErrorCode.INTERNAL_ERROR, "用户归并 alias 存在循环。");
    visited.add(currentId);
    const [row] = await queryable.select({
      id: users.id,
      status: users.status,
      mergedIntoUserId: users.mergedIntoUserId,
    }).from(users).where(eq(users.id, currentId)).limit(1);
    if (!row) return null;
    if (row.status === "active") return row.id;
    if (!row.mergedIntoUserId) throw new AppError(ErrorCode.INTERNAL_ERROR, "已归并用户缺少 canonical alias。");
    currentId = row.mergedIntoUserId;
  }

  throw new AppError(ErrorCode.INTERNAL_ERROR, "用户归并 alias 链超过安全上限。");
}

/** Resolve an Auth result to one canonical person and maintain credential rows. */
export async function resolveOrCreateCanonicalUserInTx(
  tx: TxDb,
  input: {
    authId: string;
    email: string;
    verifiedAt: Date;
    source: VerificationSource;
    allowCreate: boolean;
    authenticationStartedAt: string;
  },
): Promise<typeof users.$inferSelect> {
  const email = normalizeEmail(input.email);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`identity:${email}:${input.authId}`}, 0))`);

  const identityRows = await tx.select({ userId: userIdentities.userId })
    .from(userIdentities)
    .where(and(
      eq(userIdentities.status, "active"),
      or(
        and(eq(userIdentities.provider, "supabase_auth"), eq(userIdentities.providerSubject, input.authId)),
        and(eq(userIdentities.kind, "email"), eq(userIdentities.normalizedValue, email)),
      ),
    ));
  const legacyRows = await tx.select({ id: users.id })
    .from(users)
    .where(and(
      eq(users.status, "active"),
      or(eq(users.authId, input.authId), sql`lower(trim(${users.email})) = ${email}`),
    ));

  const canonicalIds = new Set<string>();
  for (const candidate of [...identityRows.map((row) => row.userId), ...legacyRows.map((row) => row.id)]) {
    const canonicalId = await resolveCanonicalUserId(tx, candidate);
    if (canonicalId) canonicalIds.add(canonicalId);
  }
  if (canonicalIds.size > 1) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "Auth identity 与 email identity 指向不同 canonical user，已拒绝登录绑定。");
  }

  let user: typeof users.$inferSelect | undefined;
  const existingId = canonicalIds.values().next().value as string | undefined;
  if (existingId) {
    [user] = await tx.select().from(users).where(and(eq(users.id, existingId), eq(users.status, "active"))).for("update");
  } else if (input.allowCreate) {
    [user] = await tx.insert(users).values({
      email,
      authId: input.authId,
      emailVerifiedAt: input.verifiedAt,
      emailVerificationSource: input.source,
    }).returning();
  }
  if (!user) throw identityAppError(ErrorCode.UNAUTHORIZED, "loginMethodNotBound");

  // The pre-lock lookup discovers a candidate, not authority. READ COMMITTED must
  // observe ownership again after waiting for revoke/merge/link to release users.
  if (existingId) {
    const current = await tx.select().from(userIdentities).where(and(
      eq(userIdentities.status, "active"),
      or(
        and(eq(userIdentities.provider, "supabase_auth"), eq(userIdentities.providerSubject, input.authId)),
        and(eq(userIdentities.kind, "email"), eq(userIdentities.normalizedValue, email)),
      ),
    ));
    const legacyOwnsCredential = user.authId === input.authId || normalizeEmail(user.email) === email;
    if (current.some(row => row.userId !== user!.id) ||
        (!legacyOwnsCredential && !current.some(row => row.userId === user!.id))) {
      throw identityAppError(ErrorCode.UNAUTHORIZED, "loginMethodNotBound");
    }
    // An old provider subject is not a new credential merely because the same
    // email has subsequently been explicitly linked with a different subject.
    const revokedSubject = await tx.select({ id: userIdentities.id }).from(userIdentities).where(and(
      eq(userIdentities.userId, user.id), eq(userIdentities.status, "revoked"),
      eq(userIdentities.provider, "supabase_auth"), eq(userIdentities.providerSubject, input.authId),
    )).limit(1);
    if (revokedSubject.length && !current.some(row => row.provider === "supabase_auth" && row.providerSubject === input.authId)) {
      throw identityAppError(ErrorCode.UNAUTHORIZED, "loginMethodNotBound");
    }
  }

  // Time fencing remains necessary for session/password revocation, independently
  // of the locked credential ownership check above.
  await assertFreshAuthenticationInTx(tx, user.id, input.authenticationStartedAt);
  const primaryEmail = normalizeEmail(user.email);
  const isPrimaryEmail = primaryEmail === email;
  const isPrimaryAuth = user.authId === input.authId || (isPrimaryEmail && user.authId === null);
  if (isPrimaryAuth && user.authId === null) {
    [user] = await tx.update(users).set({ authId: input.authId, updatedAt: new Date() })
      .where(eq(users.id, user.id)).returning();
  }
  if (isPrimaryEmail) {
    [user] = await tx.update(users).set({
      emailVerifiedAt: input.verifiedAt,
      emailVerificationSource: input.source,
      updatedAt: new Date(),
    }).where(eq(users.id, user.id)).returning();
  }

  await upsertActiveIdentityInTx(tx, {
    userId: user.id,
    kind: "email",
    provider: "email",
    providerSubject: email,
    normalizedValue: email,
    verifiedAt: input.verifiedAt,
    provenance: input.source,
    isPrimary: isPrimaryEmail,
  });
  await upsertActiveIdentityInTx(tx, {
    userId: user.id,
    kind: "auth",
    provider: "supabase_auth",
    providerSubject: input.authId,
    normalizedValue: email,
    verifiedAt: input.verifiedAt,
    provenance: input.source,
    isPrimary: isPrimaryAuth,
  });
  return user;
}

export async function upsertActiveIdentityInTx(
  tx: TxDb,
  input: {
    userId: string;
    kind: "email" | "auth" | "oauth" | "external";
    provider: string;
    providerSubject: string;
    normalizedValue: string | null;
    verifiedAt: Date;
    provenance: "signup_confirmation" | "existing_account_reverification" | "user_verified_link" | "merge" | "admin_migration";
    isPrimary: boolean;
  },
): Promise<void> {
  const matches = await tx.select().from(userIdentities).where(and(
    eq(userIdentities.status, "active"),
    or(
      and(eq(userIdentities.provider, input.provider), eq(userIdentities.providerSubject, input.providerSubject)),
      input.normalizedValue === null
        ? sql`false`
        : and(eq(userIdentities.kind, input.kind), eq(userIdentities.normalizedValue, input.normalizedValue)),
    ),
  )).for("update");
  const owners = new Set(matches.map((row) => row.userId));
  if (owners.size > 0 && (!owners.has(input.userId) || owners.size > 1)) {
    throw identityAppError(ErrorCode.VALIDATION_FAILED, "loginMethodAlreadyBound");
  }
  if (matches.length === 0) {
    await tx.insert(userIdentities).values(input);
    return;
  }
  await tx.update(userIdentities).set({
    verifiedAt: input.verifiedAt,
    isPrimary: matches[0]!.isPrimary || input.isPrimary,
  }).where(eq(userIdentities.id, matches[0]!.id));
}
