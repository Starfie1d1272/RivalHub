import "server-only";

import { and, eq } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import {
  matchDemoImports,
  matchMaps,
  matches,
  userGameplaySteamIds,
} from "@/db/schema";
import { writeAuditInTx } from "@/lib/audit/write";
import { AppError, ErrorCode } from "@/lib/errors";
import {
  recordGameplaySteamIdentityInTx,
  retireGameplaySteamIdentityInTx as retireCanonicalGameplaySteamIdentityInTx,
} from "@/lib/identity/gameplay-steam";
import { getDisplayName } from "@/lib/identity/display-name";
import { parseRivalHubDemoEvidenceV1 } from "@/lib/demo-evidence/contract";
import { revalidateStoredDemoImportInTx, type StoredDemoRevalidationResult } from "./revalidation";
import { sha256Json } from "./revision";
import { isCurrentDakSemanticProfile } from "./semantic-profile";
import { hasConfirmableParticipantIdentityIssue, loadCanonicalTarget, validateCanonicalTarget } from "./validation";

export const GAMEPLAY_STEAM_CONFLICT_MESSAGE = "这个 Steam64 ID 已关联到另一位选手，请先核对选手身份。";
const INVALID_STORED_PAYLOAD_MESSAGE = "这份 Demo 数据无法重新读取，请核对或拒绝。";

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

function readStoredEvidence(row: typeof matchDemoImports.$inferSelect) {
  let evidence: ReturnType<typeof parseRivalHubDemoEvidenceV1>;
  try {
    evidence = parseRivalHubDemoEvidenceV1(row.payload);
  } catch {
    throw new AppError(ErrorCode.VALIDATION_FAILED, INVALID_STORED_PAYLOAD_MESSAGE);
  }
  if (
    sha256Json(evidence) !== row.payloadSha256
    || evidence.source.demoSha256 !== row.demoSha256
    || evidence.target.seasonId !== row.seasonId
    || evidence.target.matchId !== row.matchId
    || evidence.target.matchMapId !== row.matchMapId
    || evidence.contract.contractVersion !== row.contractVersion
    || evidence.contract.semanticProfile !== row.semanticProfile
    || evidence.contract.analysisVersion !== row.analysisVersion
    || evidence.target.evidenceRevision !== row.evidenceRevision
  ) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, INVALID_STORED_PAYLOAD_MESSAGE);
  }
  return evidence;
}

export interface ConfirmStoredDemoParticipantIdentityInput {
  importId: string;
  eventRosterMemberId: string;
  observedSteam64: string;
  actorId: string;
}

export interface ConfirmStoredDemoParticipantIdentityResult extends StoredDemoRevalidationResult {
  alreadyConfirmed: boolean;
  aliasCreated: boolean;
}

export async function confirmStoredDemoParticipantIdentityInTx(
  tx: TxDb,
  input: ConfirmStoredDemoParticipantIdentityInput,
): Promise<ConfirmStoredDemoParticipantIdentityResult> {
  if (!/^\d{17}$/.test(input.observedSteam64)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "Demo Steam64 ID 格式无效。");
  }
  const { row, match, map } = await loadReviewImport(tx, input.importId);
  if (!isCurrentDakSemanticProfile(row.semanticProfile)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "只有当前 Demo 数据版本可以处理。");
  }
  if (row.status === "confirmed") {
    return { status: "confirmed", importId: row.id, issues: [], alreadyConfirmed: true, aliasCreated: false };
  }
  assertReviewable(row);
  const evidence = readStoredEvidence(row);
  const participant = evidence.participants.find((item) => item.steamId64 === input.observedSteam64);
  if (!participant) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "这个 Steam64 不在该份 Demo 数据中，不能确认。");
  }

  const target = await loadCanonicalTarget(tx, evidence.target);
  const validation = await validateCanonicalTarget(tx, evidence, target);
  const candidate = target.roster.find((member) => member.eventRosterMemberId === input.eventRosterMemberId);
  if (!candidate) throw new AppError(ErrorCode.VALIDATION_FAILED, "候选选手不在本场当前首发名单中。");
  const expectedTeam = candidate.entryId === match.entryAId ? "teamA" : candidate.entryId === match.entryBId ? "teamB" : null;
  if (expectedTeam === null || participant.observedTeamKey !== expectedTeam) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "Demo 中的队伍与所选本场首发选手不一致。");
  }

  const currentResolution = validation.resolutions.get(input.observedSteam64) ?? null;
  if (currentResolution && currentResolution.userId !== candidate.userId) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, GAMEPLAY_STEAM_CONFLICT_MESSAGE);
  }
  const currentIdentityIssue = hasConfirmableParticipantIdentityIssue(validation.issues, input.observedSteam64);
  const storedIdentityIssue = hasConfirmableParticipantIdentityIssue(row.issues, input.observedSteam64);
  // A stale stored issue may have been resolved by the same user's primary or
  // active alias before this action acquired the import lock. That path is
  // revalidation-only; a fresh score/QA issue still cannot authorize identity
  // mutation because it has no exact participant identity issue.
  if (!currentIdentityIssue && !(storedIdentityIssue && currentResolution?.userId === candidate.userId)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "这名选手当前没有待确认的 Steam 身份问题，请刷新后重试。");
  }
  const identity = currentResolution
    ? { created: false }
    : await recordGameplaySteamIdentityInTx(tx, {
        userId: candidate.userId,
        steam64: input.observedSteam64,
        provenance: "admin_confirmed_alternate",
        sourceImportId: row.id,
        actorId: input.actorId,
        reason: "管理员确认 Demo 中发现的 Steam64 属于本场首发选手。",
      });

  await writeAuditInTx(tx, {
    seasonId: match.seasonId,
    action: "match.demo.identity_confirm",
    actorId: input.actorId,
    targetId: row.id,
    meta: {
      mapOrder: map.mapOrder,
      playerName: getDisplayName(candidate),
      observedSteam64: input.observedSteam64,
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

export interface RetireSeasonGameplaySteamIdentityInput {
  identityId: string;
  seasonId: string;
  actorId: string;
  reason: string;
}

export async function retireSeasonGameplaySteamIdentityInTx(
  tx: TxDb,
  input: RetireSeasonGameplaySteamIdentityInput,
): Promise<{ retired: boolean }> {
  const reason = input.reason.trim();
  if (reason.length < 2 || reason.length > 500) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "撤销比赛 Steam 身份必须填写原因。");
  }
  const [identity] = await tx.select().from(userGameplaySteamIds)
    .where(eq(userGameplaySteamIds.id, input.identityId))
    .for("update");
  if (!identity) throw new AppError(ErrorCode.NOT_FOUND, "Steam 游戏身份不存在。");
  if (identity.provenance !== "admin_confirmed_alternate" || !identity.sourceImportId) {
    throw new AppError(ErrorCode.FORBIDDEN, "只能撤销由比赛确认产生的 Steam 身份。");
  }
  const [sourceImport] = await tx.select({ seasonId: matchDemoImports.seasonId })
    .from(matchDemoImports)
    .where(eq(matchDemoImports.id, identity.sourceImportId));
  if (!sourceImport || sourceImport.seasonId !== input.seasonId) {
    throw new AppError(ErrorCode.FORBIDDEN, "该 Steam 身份不属于当前赛事。");
  }

  const result = await retireCanonicalGameplaySteamIdentityInTx(tx, {
    identityId: identity.id,
    actorId: input.actorId,
    reason,
  });
  await writeAuditInTx(tx, {
    seasonId: input.seasonId,
    action: "match.demo.identity_retire",
    actorId: input.actorId,
    targetId: identity.id,
    meta: { observedSteam64: identity.steam64, retired: result.retired },
  });
  return result;
}
