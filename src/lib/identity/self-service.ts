import "server-only";

import { and, eq, gt, inArray, isNotNull } from "drizzle-orm";
import type { DB, TxDb } from "@/db/client";
import { userIdentities, userMergeAuthorizations, users } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { getDisplayName } from "@/lib/identity/display-name";

type IdentityReader = Pick<DB, "select"> | Pick<TxDb, "select">;

export interface SelfServiceMergeAuthorization {
  id: string;
  initiatingUserId: string;
  counterpartyUserId: string;
  expiresAt: Date;
  accounts: Array<{ id: string; email: string; label: string }>;
}

export async function loadSelfServiceMergeAuthorization(
  reader: IdentityReader,
  input: { authorizationId: string; actorUserId: string },
): Promise<SelfServiceMergeAuthorization> {
  const [authorization] = await reader.select({
    id: userMergeAuthorizations.id,
    initiatingUserId: userMergeAuthorizations.initiatingUserId,
    counterpartyUserId: userMergeAuthorizations.counterpartyUserId,
    expiresAt: userMergeAuthorizations.expiresAt,
  }).from(userMergeAuthorizations)
    .innerJoin(userIdentities, and(
      eq(userIdentities.id, userMergeAuthorizations.provenIdentityId),
      eq(userIdentities.userId, userMergeAuthorizations.counterpartyUserId),
      eq(userIdentities.status, "active"),
      isNotNull(userIdentities.verifiedAt),
    ))
    .where(and(
      eq(userMergeAuthorizations.id, input.authorizationId),
      eq(userMergeAuthorizations.initiatingUserId, input.actorUserId),
      eq(userMergeAuthorizations.status, "available"),
      gt(userMergeAuthorizations.expiresAt, new Date()),
    ))
    .limit(1);
  if (!authorization) {
    throw new AppError(ErrorCode.FORBIDDEN, "账号归并授权无效或已过期，请重新验证另一个账号的邮箱。");
  }

  const accounts = await reader.select({
    id: users.id,
    email: users.email,
    displayName: users.displayName,
    perfectName: users.perfectName,
    steamName: users.steamName,
  }).from(users).where(and(
    inArray(users.id, [authorization.initiatingUserId, authorization.counterpartyUserId]),
    eq(users.status, "active"),
  ));
  if (accounts.length !== 2) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "归并候选账号状态已变化，请重新开始。");
  }

  return {
    ...authorization,
    accounts: accounts.map((account) => ({
      id: account.id,
      email: account.email,
      label: getDisplayName(account),
    })),
  };
}

export function selectSelfServiceMergePair(
  authorization: SelfServiceMergeAuthorization,
  canonicalUserId: string,
): { canonicalUserId: string; mergedUserId: string } {
  const ids = new Set([authorization.initiatingUserId, authorization.counterpartyUserId]);
  if (!ids.has(canonicalUserId)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "canonical user 必须是已证明控制的两个账号之一。");
  }
  const mergedUserId = canonicalUserId === authorization.initiatingUserId
    ? authorization.counterpartyUserId
    : authorization.initiatingUserId;
  return { canonicalUserId, mergedUserId };
}
