import "server-only";

import { eq } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { matchDemoImports } from "@/db/schema";
import { writeAuditInTx } from "@/lib/audit/write";
import { AppError, ErrorCode } from "@/lib/errors";
import { parseRivalHubDemoEvidenceV1 } from "@/lib/demo-evidence/contract";
import type { IntegrationIssue, RivalHubEvidenceSubmission } from "./contracts";
import { DEMO_CONTENT_CONFLICT_MESSAGE, lockDemoImportLineageInTx, promoteDemoImportInTx, resolveDemoImportLineageInTx } from "./promotion";
import { buildEvidenceRevisionForTarget, sha256Json } from "./revision";
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
