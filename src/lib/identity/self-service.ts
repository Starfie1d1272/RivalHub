import "server-only";

import { and, eq, gt, inArray, isNotNull, isNull } from "drizzle-orm";
import type { DB, TxDb } from "@/db/client";
import { teamMemberships, teams, userIdentities, userMergeAuthorizations, users } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { getDisplayName } from "@/lib/identity/display-name";

type IdentityReader = Pick<DB, "select"> | Pick<TxDb, "select">;

export interface SelfServiceMergeAuthorization {
  id: string;
  initiatingUserId: string;
  counterpartyUserId: string;
  expiresAt: Date;
  accounts: Array<{ id: string; email: string; label: string; steam64: string | null; teamName: string | null }>;
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
    steam64: users.steam64,
  }).from(users).where(and(
    inArray(users.id, [authorization.initiatingUserId, authorization.counterpartyUserId]),
    eq(users.status, "active"),
  ));
  if (accounts.length !== 2) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "归并候选账号状态已变化，请重新开始。");
  }

  const currentTeams = await reader.select({ userId: teamMemberships.userId, teamName: teams.name })
    .from(teamMemberships)
    .innerJoin(teams, eq(teams.id, teamMemberships.teamId))
    .where(and(
      inArray(teamMemberships.userId, accounts.map((account) => account.id)),
      isNull(teamMemberships.endedAt),
      eq(teams.status, "active"),
    ));
  const teamByUser = new Map(currentTeams.map((team) => [team.userId, team.teamName]));

  return {
    ...authorization,
    accounts: accounts.map((account) => ({
      id: account.id,
      email: account.email,
      label: getDisplayName(account),
      steam64: account.steam64,
      teamName: teamByUser.get(account.id) ?? null,
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
