import "server-only";

import { desc, eq } from "drizzle-orm";
import { db, type TxDb } from "@/db/client";
import { matchDemoImports } from "@/db/schema";
import { writeAuditInTx } from "@/lib/audit/write";
import { AppError, ErrorCode } from "@/lib/errors";
import { parseRivalHubDemoEvidenceV1 } from "@/lib/demo-evidence/contract";
import type { IntegrationIssue, RivalHubEvidenceSubmission } from "./contracts";
import { DEMO_CONTENT_CONFLICT_MESSAGE, lockDemoImportLineageInTx, promoteDemoImportInTx, resolveDemoImportLineageInTx } from "./promotion";
import { buildEvidenceRevisionForTarget, sha256Json } from "./revision";
import { selectCurrentDemoImport } from "./read";
import { isCurrentDakSemanticProfile } from "./semantic-profile";
import { integrationIssue, loadCanonicalTarget, validateCanonicalTarget, type CanonicalTarget } from "./validation";

const INVALID_STORED_PAYLOAD_MESSAGE = "这份 Demo 数据无法重新读取，请核对或拒绝。";

export interface StoredDemoRevalidationResult {
  status: "confirmed" | "needs_attention";
  importId: string;
  issues: IntegrationIssue[];
}

interface StoredEvidenceResult {
  evidence: RivalHubEvidenceSubmission | null;
  issues: IntegrationIssue[];
}

function parseStoredEvidence(row: typeof matchDemoImports.$inferSelect): StoredEvidenceResult {
  let evidence: RivalHubEvidenceSubmission;
  try {
    evidence = parseRivalHubDemoEvidenceV1(row.payload);
  } catch {
    return { evidence: null, issues: [integrationIssue("STORED_PAYLOAD_INVALID", INVALID_STORED_PAYLOAD_MESSAGE)] };
  }

  const issues: IntegrationIssue[] = [];
  if (sha256Json(evidence) !== row.payloadSha256) issues.push(integrationIssue("STORED_PAYLOAD_HASH_MISMATCH", INVALID_STORED_PAYLOAD_MESSAGE));
  if (evidence.source.demoSha256 !== row.demoSha256) issues.push(integrationIssue("STORED_DEMO_HASH_MISMATCH", INVALID_STORED_PAYLOAD_MESSAGE));
  if (evidence.contract.contractVersion !== row.contractVersion || evidence.contract.semanticProfile !== row.semanticProfile || evidence.contract.analysisVersion !== row.analysisVersion) {
    issues.push(integrationIssue("STORED_PAYLOAD_METADATA_MISMATCH", INVALID_STORED_PAYLOAD_MESSAGE));
  }
  if (evidence.target.evidenceRevision !== row.evidenceRevision) issues.push(integrationIssue("STORED_EVIDENCE_REVISION_MISMATCH", INVALID_STORED_PAYLOAD_MESSAGE));
  if (evidence.target.seasonId !== row.seasonId || evidence.target.matchId !== row.matchId || evidence.target.matchMapId !== row.matchMapId) {
    issues.push(integrationIssue("STORED_TARGET_MISMATCH", INVALID_STORED_PAYLOAD_MESSAGE));
  }
  return { evidence, issues };
}

async function writeRecheckIssue(
  tx: TxDb,
  row: typeof matchDemoImports.$inferSelect,
  issues: IntegrationIssue[],
  target?: CanonicalTarget,
  actorId?: string,
): Promise<StoredDemoRevalidationResult> {
  await tx.update(matchDemoImports).set({ issues }).where(eq(matchDemoImports.id, row.id));
  await writeAuditInTx(tx, {
    seasonId: row.seasonId,
    action: "match.demo.recheck",
    actorId: actorId ?? "system:demo-recheck",
    targetId: row.id,
    meta: {
      ...(target ? { mapOrder: target.map.mapOrder } : {}),
      issueCount: issues.length,
    },
  });
  return { status: "needs_attention", importId: row.id, issues };
}

export async function revalidateStoredDemoImportInTx(
  tx: TxDb,
  input: { importId: string; actorId: string; verifiedBy?: string },
): Promise<StoredDemoRevalidationResult> {
  const [scope] = await tx.select({ matchMapId: matchDemoImports.matchMapId }).from(matchDemoImports)
    .where(eq(matchDemoImports.id, input.importId));
  if (!scope) throw new AppError(ErrorCode.NOT_FOUND, "待处理的 Demo 数据不存在。");
  await lockDemoImportLineageInTx(tx, scope.matchMapId);
  const [row] = await tx.select().from(matchDemoImports)
    .where(eq(matchDemoImports.id, input.importId))
    .for("update");
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, "待处理的 Demo 数据不存在。");
  if (row.matchMapId !== scope.matchMapId) throw new AppError(ErrorCode.INTERNAL_ERROR, "Demo 数据在重新检查期间发生了目标变化。");
  if (!isCurrentDakSemanticProfile(row.semanticProfile)) throw new AppError(ErrorCode.VALIDATION_FAILED, "只有当前 Demo 数据版本可以重新检查。");
  if (row.status === "confirmed") return { status: "confirmed", importId: row.id, issues: [] };
  if (row.status !== "needs_attention") throw new AppError(ErrorCode.VALIDATION_FAILED, "这份 Demo 数据当前不在待处理状态。");

  const stored = parseStoredEvidence(row);
  if (!stored.evidence || stored.issues.length > 0) return writeRecheckIssue(tx, row, stored.issues, undefined, input.actorId);

  let target: CanonicalTarget;
  try {
    target = await loadCanonicalTarget(tx, stored.evidence.target);
  } catch {
    return writeRecheckIssue(tx, row, [integrationIssue("STORED_TARGET_INVALID", INVALID_STORED_PAYLOAD_MESSAGE)], undefined, input.actorId);
  }

  const validation = await validateCanonicalTarget(tx, stored.evidence, target);
  const issues = [...validation.issues];
  const currentRevision = buildEvidenceRevisionForTarget(target);
  if (stored.evidence.target.evidenceRevision !== currentRevision) {
    issues.push(integrationIssue("STALE_EVIDENCE", "Demo Evidence 基于旧的赛事/阵容/比分快照，请刷新后重新生成。", "target.evidenceRevision"));
  }

  const lineage = await resolveDemoImportLineageInTx(tx, {
    matchMapId: target.map.id,
    demoSha256: row.demoSha256,
    payloadSha256: row.payloadSha256,
    currentImportId: row.id,
  });
  if (lineage.differentDemoConfirmed) {
    issues.push(integrationIssue("CONTENT_CONFLICT", DEMO_CONTENT_CONFLICT_MESSAGE, "source.demoSha256"));
  }
  if (issues.length > 0) return writeRecheckIssue(tx, row, issues, target, input.actorId);

  await promoteDemoImportInTx({
    tx,
    row,
    evidence: stored.evidence,
    target,
    resolutions: validation.resolutions,
    actorId: input.actorId,
    verifiedBy: input.verifiedBy ?? `admin:${input.actorId}`,
    auditAction: "match.demo.recheck",
    retryPromotion: true,
  });
  return { status: "confirmed", importId: row.id, issues: [] };
}


export interface RelatedDemoRevalidationSummary {
  attempted: number;
  confirmed: number;
  remaining: number;
  failed: number;
  affectedMatchIds: string[];
}

type RecheckCandidate = typeof matchDemoImports.$inferSelect;

async function loadSeasonNeedsAttentionCandidates(seasonId: string): Promise<RecheckCandidate[]> {
  const rows = await db
    .select()
    .from(matchDemoImports)
    .where(eq(matchDemoImports.seasonId, seasonId))
    .orderBy(desc(matchDemoImports.createdAt));

  const rowsByMap = new Map<string, RecheckCandidate[]>();
  for (const row of rows) {
    const mapRows = rowsByMap.get(row.matchMapId) ?? [];
    mapRows.push(row);
    rowsByMap.set(row.matchMapId, mapRows);
  }

  const currentNeedsAttention: RecheckCandidate[] = [];
  for (const mapRows of rowsByMap.values()) {
    const current = selectCurrentDemoImport(mapRows);
    if (current?.status === "needs_attention") currentNeedsAttention.push(current);
  }
  return currentNeedsAttention;
}

async function revalidateCandidateRows(
  rows: readonly RecheckCandidate[],
  actorId: string,
): Promise<RelatedDemoRevalidationSummary> {
  let confirmed = 0;
  let remaining = 0;
  let failed = 0;
  const affectedMatchIds = new Set<string>();

  for (const row of rows) {
    try {
      const result = await db.transaction((tx) => revalidateStoredDemoImportInTx(tx, {
        importId: row.id,
        actorId,
        verifiedBy: `admin:${actorId}`,
      }));
      affectedMatchIds.add(row.matchId);
      if (result.status === "confirmed") confirmed++;
      else remaining++;
    } catch {
      failed++;
    }
  }

  return {
    attempted: rows.length,
    confirmed,
    remaining,
    failed,
    affectedMatchIds: [...affectedMatchIds],
  };
}

/**
 * Recheck every current-profile needs_attention import in one season. This is
 * intentionally a deterministic recomputation only: it does not alter identity,
 * roster, source payload or evidence metadata.
 */
export async function revalidateSeasonNeedsAttentionImports(input: {
  seasonId: string;
  actorId: string;
}): Promise<RelatedDemoRevalidationSummary> {
  const rows = (await loadSeasonNeedsAttentionCandidates(input.seasonId))
    .filter((row) => isCurrentDakSemanticProfile(row.semanticProfile));
  return revalidateCandidateRows(rows, input.actorId);
}

/**
 * Recheck other current-profile needs_attention imports in the same season that
 * contain the same observed Steam64. Each import runs in its own transaction so
 * confirming one gameplay identity never creates a multi-map lock convoy.
 */
export async function revalidateNeedsAttentionImportsForSteam64(input: {
  seasonId: string;
  steam64: string;
  actorId: string;
  excludeImportId?: string;
}): Promise<RelatedDemoRevalidationSummary> {
  if (!/^\d{17}$/.test(input.steam64)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "Steam64 ID 格式无效。");
  }

  const matching = (await loadSeasonNeedsAttentionCandidates(input.seasonId)).filter((row) => {
    if (row.id === input.excludeImportId || !isCurrentDakSemanticProfile(row.semanticProfile)) return false;
    try {
      return parseRivalHubDemoEvidenceV1(row.payload).participants.some((participant) => participant.steamId64 === input.steam64);
    } catch {
      return false;
    }
  });

  return revalidateCandidateRows(matching, input.actorId);
}
