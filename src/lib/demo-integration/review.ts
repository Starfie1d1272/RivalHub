import "server-only";

import { and, eq } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import {
  matchDemoImports,
  matchMaps,
  matches,
  userGameplaySteamIds,
  users,
} from "@/db/schema";
import { writeAuditInTx } from "@/lib/audit/write";
import { AppError, ErrorCode } from "@/lib/errors";
import { loadEffectiveMatchRoster } from "@/lib/match-rosters/effective";
import { isCurrentDakSemanticProfile } from "./semantic-profile";
import {
  revalidateStoredDemoImportInTx,
  type StoredDemoRevalidationResult,
} from "./submit";

export const GAMEPLAY_STEAM_CONFLICT_MESSAGE = "这个 Steam64 ID 已关联到另一位选手，请先核对选手身份。";

export interface GameplaySteamIdentityResult {
  aliasId: string | null;
  created: boolean;
}

export async function ensureGameplaySteamIdentityInTx(
  tx: TxDb,
  input: {
    userId: string;
    steam64: string;
    sourceImportId: string | null;
    confirmedByUserId: string;
  },
): Promise<GameplaySteamIdentityResult> {
  const [primaryRows, aliasRows] = await Promise.all([
    tx.select({ userId: users.id })
      .from(users)
      .where(and(eq(users.status, "active"), eq(users.steam64, input.steam64)))
      .for("update"),
    tx.select({ id: userGameplaySteamIds.id, userId: userGameplaySteamIds.userId })
      .from(userGameplaySteamIds)
      .where(and(eq(userGameplaySteamIds.status, "active"), eq(userGameplaySteamIds.steam64, input.steam64)))
      .for("update"),
  ]);
  const owners = new Set([...primaryRows.map((row) => row.userId), ...aliasRows.map((row) => row.userId)]);
  if ([...owners].some((userId) => userId !== input.userId) || owners.size > 1) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, GAMEPLAY_STEAM_CONFLICT_MESSAGE);
  }
  if (primaryRows.some((row) => row.userId === input.userId)) return { aliasId: null, created: false };
  const existingAlias = aliasRows.find((row) => row.userId === input.userId);
  if (existingAlias) return { aliasId: existingAlias.id, created: false };

  const [created] = await tx.insert(userGameplaySteamIds).values({
    userId: input.userId,
    steam64: input.steam64,
    sourceImportId: input.sourceImportId,
    confirmedByUserId: input.confirmedByUserId,
    reason: "管理员确认 Demo 中发现的 Steam64 属于本场选手",
  }).returning({ id: userGameplaySteamIds.id });
  if (!created) throw new AppError(ErrorCode.INTERNAL_ERROR, "保存比赛 Steam 身份失败。");
  return { aliasId: created.id, created: true };
}

async function loadReviewImport(tx: TxDb, importId: string) {
  const [row] = await tx.select().from(matchDemoImports)
    .where(eq(matchDemoImports.id, importId))
    .for("update");
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, "待处理的 Demo 数据不存在。");
  const [match] = await tx.select().from(matches)
    .where(and(eq(matches.id, row.matchId), eq(matches.seasonId, row.seasonId)))
    .for("update");
  if (!match) throw new AppError(ErrorCode.NOT_FOUND, "Demo 对应的比赛不存在。");
  const [map] = await tx.select().from(matchMaps)
    .where(and(eq(matchMaps.id, row.matchMapId), eq(matchMaps.matchId, match.id)));
  if (!map) throw new AppError(ErrorCode.NOT_FOUND, "Demo 对应的地图不存在。");
  return { row, match, map };
}

function assertReviewable(row: typeof matchDemoImports.$inferSelect): void {
  if (!isCurrentDakSemanticProfile(row.semanticProfile)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "只有当前 Demo 数据版本可以处理。");
  }
  if (row.status !== "needs_attention") {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "这份 Demo 数据当前不在待处理状态。");
  }
}

export interface ConfirmGameplaySteamIdentityInput {
  importId: string;
  eventRosterMemberId: string;
  observedSteam64: string;
  actorId: string;
}

export interface ConfirmGameplaySteamIdentityResult extends StoredDemoRevalidationResult {
  alreadyConfirmed: boolean;
  aliasCreated: boolean;
}

export async function confirmGameplaySteamIdentityInTx(
  tx: TxDb,
  input: ConfirmGameplaySteamIdentityInput,
): Promise<ConfirmGameplaySteamIdentityResult> {
  if (!/^\d{17}$/.test(input.observedSteam64)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "Demo Steam64 ID 格式无效。");
  }
  const { row, match, map } = await loadReviewImport(tx, input.importId);
  if (row.status === "confirmed") {
    return { status: "confirmed", issues: [], alreadyConfirmed: true, aliasCreated: false };
  }
  assertReviewable(row);

  const roster = await loadEffectiveMatchRoster(tx, [match.id]);
  const candidate = roster.find((member) => member.eventRosterMemberId === input.eventRosterMemberId);
  if (!candidate) throw new AppError(ErrorCode.VALIDATION_FAILED, "候选选手不在本场已确认首发名单中。");

  const identity = await ensureGameplaySteamIdentityInTx(tx, {
    userId: candidate.userId,
    steam64: input.observedSteam64,
    sourceImportId: row.id,
    confirmedByUserId: input.actorId,
  });
  await writeAuditInTx(tx, {
    seasonId: match.seasonId,
    action: "match.demo.identity_confirm",
    actorId: input.actorId,
    targetId: row.id,
    meta: {
      mapOrder: map.mapOrder,
      eventRosterMemberId: candidate.eventRosterMemberId,
      aliasCreated: identity.created,
    },
  });

  const recheck = await revalidateStoredDemoImportInTx(tx, {
    importId: row.id,
    actorId: input.actorId,
    verifiedBy: `admin:${input.actorId}`,
  });
  return { ...recheck, alreadyConfirmed: false, aliasCreated: identity.created };
}

export interface RejectStoredDemoImportInput {
  importId: string;
  actorId: string;
}

export async function rejectStoredDemoImportInTx(
  tx: TxDb,
  input: RejectStoredDemoImportInput,
): Promise<{ alreadyRejected: boolean }> {
  const { row, match, map } = await loadReviewImport(tx, input.importId);
  if (row.status === "rejected") return { alreadyRejected: true };
  assertReviewable(row);
  await tx.update(matchDemoImports).set({ status: "rejected" }).where(eq(matchDemoImports.id, row.id));
  await writeAuditInTx(tx, {
    seasonId: match.seasonId,
    action: "match.demo.reject",
    actorId: input.actorId,
    targetId: row.id,
    meta: { mapOrder: map.mapOrder, issueCount: Array.isArray(row.issues) ? row.issues.length : 0 },
  });
  return { alreadyRejected: false };
}

export interface RetireGameplaySteamIdentityInput {
  aliasId: string;
  actorId: string;
  reason: string;
}

export async function retireGameplaySteamIdentityInTx(
  tx: TxDb,
  input: RetireGameplaySteamIdentityInput,
): Promise<{ alreadyRetired: boolean }> {
  const reason = input.reason.trim();
  if (reason.length < 2 || reason.length > 500) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "撤销比赛 Steam 身份必须填写原因。");
  }
  const [alias] = await tx.select().from(userGameplaySteamIds)
    .where(eq(userGameplaySteamIds.id, input.aliasId))
    .for("update");
  if (!alias) throw new AppError(ErrorCode.NOT_FOUND, "比赛 Steam 身份不存在。");
  if (alias.status === "retired") return { alreadyRetired: true };
  await tx.update(userGameplaySteamIds).set({
    status: "retired",
    retiredByUserId: input.actorId,
    retiredAt: new Date(),
    retiredReason: reason,
  }).where(eq(userGameplaySteamIds.id, alias.id));
  await writeAuditInTx(tx, {
    action: "match.demo.identity_retire",
    actorId: input.actorId,
    targetId: alias.id,
    meta: { userId: alias.userId },
  });
  return { alreadyRetired: false };
}
