import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq, gt, inArray, or } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import {
  auditLogs,
  identityLinkRequests,
  userIdentities,
  userMergeAuthorizations,
} from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { resolveCanonicalUserId, upsertActiveIdentityInTx } from "@/lib/identity/canonical";
import { normalizeEmail } from "@/lib/utils/email";

const MERGE_AUTHORIZATION_TTL_MS = 30 * 60 * 1000;

export function hashIdentityLinkState(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type CompleteIdentityLinkOutcome =
  | { kind: "linked" }
  | { kind: "merge_required"; authorizationId: string };

export async function completeSecondaryIdentityLinkInTx(
  tx: TxDb,
  input: {
    requestId: string;
    stateToken: string;
    currentUserId: string;
    authId: string;
    email: string;
    verifiedAt: Date;
  },
): Promise<CompleteIdentityLinkOutcome> {
  const [request] = await tx.select().from(identityLinkRequests)
    .where(eq(identityLinkRequests.id, input.requestId)).for("update");
  const stateMatches = request ? safeHashEqual(request.stateTokenHash, hashIdentityLinkState(input.stateToken)) : false;
  const canonicalCurrentId = await resolveCanonicalUserId(tx, input.currentUserId);
  const normalizedEmail = normalizeEmail(input.email);
  if (
    !request ||
    !stateMatches ||
    !canonicalCurrentId ||
    request.userId !== canonicalCurrentId ||
    request.status !== "pending" ||
    request.expiresAt <= new Date() ||
    request.normalizedEmail !== normalizedEmail
  ) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "邮箱绑定请求已失效，请重新发起。");
  }

  const matchingIdentities = await tx.select().from(userIdentities).where(and(
    eq(userIdentities.status, "active"),
    or(
      and(eq(userIdentities.kind, "email"), eq(userIdentities.normalizedValue, normalizedEmail)),
      and(eq(userIdentities.provider, "supabase_auth"), eq(userIdentities.providerSubject, input.authId)),
    ),
  )).for("update");
  const ownerIds = new Set<string>();
  for (const identity of matchingIdentities) {
    const ownerId = await resolveCanonicalUserId(tx, identity.userId);
    if (ownerId) ownerIds.add(ownerId);
  }

  if (ownerIds.size > 1) {
    await tx.update(identityLinkRequests).set({ status: "blocked", completedAt: new Date() })
      .where(eq(identityLinkRequests.id, request.id));
    throw new AppError(ErrorCode.INTERNAL_ERROR, "邮箱与 Auth credential 的 canonical owner 不一致，已拒绝绑定。");
  }

  const existingOwnerId = ownerIds.values().next().value as string | undefined;
  if (existingOwnerId && existingOwnerId !== canonicalCurrentId) {
    const provenIdentity = matchingIdentities.find((identity) => identity.userId === existingOwnerId)
      ?? matchingIdentities[0];
    if (!provenIdentity) throw new AppError(ErrorCode.INTERNAL_ERROR, "缺少已验证的冲突 identity。");
    const [authorization] = await tx.insert(userMergeAuthorizations).values({
      initiatingUserId: canonicalCurrentId,
      counterpartyUserId: existingOwnerId,
      provenIdentityId: provenIdentity.id,
      expiresAt: new Date(Date.now() + MERGE_AUTHORIZATION_TTL_MS),
    }).returning({ id: userMergeAuthorizations.id });
    if (!authorization) throw new AppError(ErrorCode.INTERNAL_ERROR, "无法建立 self-service merge 授权。");
    await tx.update(identityLinkRequests).set({ status: "merge_required", completedAt: new Date() })
      .where(eq(identityLinkRequests.id, request.id));
    await tx.insert(auditLogs).values({
      action: "identity.link.merge_required",
      actorId: canonicalCurrentId,
      targetId: authorization.id,
      targetType: "user_merge_authorization",
      meta: { counterpartyUserId: existingOwnerId },
    });
    return { kind: "merge_required", authorizationId: authorization.id };
  }

  await upsertActiveIdentityInTx(tx, {
    userId: canonicalCurrentId,
    kind: "email",
    provider: "email",
    providerSubject: normalizedEmail,
    normalizedValue: normalizedEmail,
    verifiedAt: input.verifiedAt,
    provenance: "user_verified_link",
    isPrimary: false,
  });
  await upsertActiveIdentityInTx(tx, {
    userId: canonicalCurrentId,
    kind: "auth",
    provider: "supabase_auth",
    providerSubject: input.authId,
    normalizedValue: normalizedEmail,
    verifiedAt: input.verifiedAt,
    provenance: "user_verified_link",
    isPrimary: false,
  });
  await tx.update(identityLinkRequests).set({ status: "completed", completedAt: new Date() })
    .where(eq(identityLinkRequests.id, request.id));
  await tx.insert(auditLogs).values({
    action: "identity.link.complete",
    actorId: canonicalCurrentId,
    targetId: canonicalCurrentId,
    targetType: "user",
    meta: { kind: "email", primary: false },
  });
  return { kind: "linked" };
}

export async function revokeSecondaryEmailIdentityInTx(
  tx: TxDb,
  input: { userId: string; identityId: string },
): Promise<void> {
  const canonicalUserId = await resolveCanonicalUserId(tx, input.userId);
  if (!canonicalUserId) throw new AppError(ErrorCode.UNAUTHORIZED, "账号不存在，请重新登录。");
  const [identity] = await tx.select().from(userIdentities).where(and(
    eq(userIdentities.id, input.identityId),
    eq(userIdentities.userId, canonicalUserId),
    eq(userIdentities.kind, "email"),
    eq(userIdentities.status, "active"),
  )).for("update");
  if (!identity) throw new AppError(ErrorCode.NOT_FOUND, "secondary email identity 不存在。");
  if (identity.isPrimary || !identity.normalizedValue) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "primary login identity 不能在这里撤销。");
  }
  const related = await tx.select().from(userIdentities).where(and(
    eq(userIdentities.userId, canonicalUserId),
    eq(userIdentities.status, "active"),
    eq(userIdentities.normalizedValue, identity.normalizedValue),
  )).for("update");
  if (related.some((row) => row.isPrimary)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "该邮箱仍属于 primary login identity，不能撤销。");
  }
  const now = new Date();
  await tx.update(userIdentities).set({
    status: "revoked",
    isPrimary: false,
    retiredAt: now,
    retiredReason: "self_revoke",
  }).where(inArray(userIdentities.id, related.map((row) => row.id)));
  await tx.insert(auditLogs).values({
    action: "identity.link.revoke",
    actorId: canonicalUserId,
    targetId: identity.id,
    targetType: "user_identity",
    meta: { kind: "email", relatedCredentialCount: related.length },
  });
}

export async function listVerifiedEmailIdentities(
  tx: Pick<TxDb, "select">,
  userId: string,
): Promise<Array<{ id: string; email: string; primary: boolean; verifiedAt: Date }>> {
  return tx.select({
    id: userIdentities.id,
    email: userIdentities.normalizedValue,
    primary: userIdentities.isPrimary,
    verifiedAt: userIdentities.verifiedAt,
  }).from(userIdentities).where(and(
    eq(userIdentities.userId, userId),
    eq(userIdentities.kind, "email"),
    eq(userIdentities.status, "active"),
    gt(userIdentities.verifiedAt, new Date(0)),
  )).then((rows) => rows.flatMap((row) => row.email && row.verifiedAt ? [{ ...row, email: row.email, verifiedAt: row.verifiedAt }] : []));
}

function safeHashEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
