import "server-only";

import { eq } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { db } from "@/db/client";
import { matchDemoImports, type DakPairing } from "@/db/schema";
import { writeAuditInTx } from "@/lib/audit/write";
import { AppError, ErrorCode } from "@/lib/errors";
import { parseRivalHubDemoEvidenceV1 } from "@/lib/demo-evidence/contract";
import type { IntegrationIssue, EvidenceSubmissionResponse, RivalHubEvidenceSubmission } from "./contracts";
import { pairingCanReadSeason } from "./pairing";
import { DEMO_CONTENT_CONFLICT_MESSAGE, isSameDemoImportContent, lockDemoImportLineageInTx, promoteDemoImportInTx, resolveDemoImportLineageInTx } from "./promotion";
import { buildEvidenceRevisionForTarget, sha256Json } from "./revision";
import { integrationIssue, loadCanonicalTarget, validateCanonicalTarget } from "./validation";

export { dakStableScoreboardValues } from "./scoreboard";
export { revalidateStoredDemoImportInTx } from "./revalidation";
export type { StoredDemoRevalidationResult } from "./revalidation";

export interface SubmitEvidenceArgs {
  input: unknown;
  pairingId: string;
  pairingScope: Pick<DakPairing, "seasonIds">;
  idempotencyKey?: string | null;
}

function statusOf(row: typeof matchDemoImports.$inferSelect): EvidenceSubmissionResponse["status"] {
  return row.status === "confirmed" ? "synced" : "needs_attention";
}

export function assertEvidenceSeasonInPairingScope(
  pairing: Pick<DakPairing, "seasonIds">,
  seasonId: string,
): void {
  if (!pairingCanReadSeason(pairing, seasonId)) {
    throw new AppError(ErrorCode.FORBIDDEN, "DAK 连接无权提交该赛季的 Demo Evidence。");
  }
}

function responseFor(
  row: typeof matchDemoImports.$inferSelect,
  issues: readonly IntegrationIssue[] = row.issues ?? [],
): EvidenceSubmissionResponse {
  return {
    status: statusOf(row),
    importId: row.id,
    matchMapId: row.matchMapId,
    demoSha256: row.demoSha256,
    issues: [...issues],
  };
}

function parseSubmission(input: unknown): RivalHubEvidenceSubmission {
  try {
    return parseRivalHubDemoEvidenceV1(input);
  } catch (error) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `Demo Evidence V1 校验失败：${error instanceof Error ? error.message : "格式不合法"}`);
  }
}

async function validateEvidenceForTarget(
  tx: TxDb,
  evidence: RivalHubEvidenceSubmission,
) {
  const target = await loadCanonicalTarget(tx, evidence.target);
  const validation = await validateCanonicalTarget(tx, evidence, target);
  const currentRevision = buildEvidenceRevisionForTarget(target);
  const issues = [...validation.issues];
  if (evidence.target.evidenceRevision !== currentRevision) {
    issues.push(integrationIssue("STALE_EVIDENCE", "Demo Evidence 基于旧的赛事/阵容/比分快照，请刷新后重新生成。", "target.evidenceRevision"));
  }
  return { target, validation, currentRevision, issues };
}

export async function submitRivalHubEvidence(args: SubmitEvidenceArgs): Promise<EvidenceSubmissionResponse> {
  const evidence = parseSubmission(args.input);
  assertEvidenceSeasonInPairingScope(args.pairingScope, evidence.target.seasonId);
  if (args.idempotencyKey && (args.idempotencyKey.length < 8 || args.idempotencyKey.length > 200)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "Idempotency-Key 长度不合法。");
  }
  const payloadSha256 = sha256Json(evidence);

  return db.transaction(async (tx) => {
    await lockDemoImportLineageInTx(tx, evidence.target.matchMapId);
    let idempotent: typeof matchDemoImports.$inferSelect | undefined;
    if (args.idempotencyKey) {
      [idempotent] = await tx.select().from(matchDemoImports)
        .where(eq(matchDemoImports.idempotencyKey, args.idempotencyKey))
        .for("update");
      if (idempotent && !isSameDemoImportContent(idempotent, {
        demoSha256: evidence.source.demoSha256,
        payloadSha256,
      })) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, "Idempotency-Key 已用于另一份 Demo Evidence。");
      }
    }

    const { target, validation, currentRevision, issues } = await validateEvidenceForTarget(tx, evidence);
    const lineage = await resolveDemoImportLineageInTx(tx, {
      matchMapId: target.map.id,
      demoSha256: evidence.source.demoSha256,
      payloadSha256,
    });
    const same = idempotent ?? lineage.sameContent;

    if (same) {
      if (same.status === "confirmed") {
        if (same.evidenceRevision === currentRevision && issues.length === 0) return responseFor(same, []);
        return { ...responseFor(same, issues), status: "needs_attention" };
      }
      if (lineage.differentDemoConfirmed) {
        issues.push(integrationIssue("CONTENT_CONFLICT", DEMO_CONTENT_CONFLICT_MESSAGE, "source.demoSha256"));
      }
      if (same.status === "needs_attention" && issues.length === 0) {
        await promoteDemoImportInTx({
          tx,
          row: same,
          evidence,
          target,
          resolutions: validation.resolutions,
          actorId: `dak:${args.pairingId}`,
          verifiedBy: `dak:${args.pairingId}`,
          auditAction: "match.demo.auto_confirm",
          retryPromotion: true,
        });
        return { ...responseFor({ ...same, status: "confirmed", issues: [] }), status: "synced", issues: [] };
      }
      await tx.update(matchDemoImports).set({ issues }).where(eq(matchDemoImports.id, same.id));
      return responseFor({ ...same, issues }, issues);
    }

    if (lineage.differentDemoConfirmed) {
      issues.push(integrationIssue("CONTENT_CONFLICT", DEMO_CONTENT_CONFLICT_MESSAGE, "source.demoSha256"));
    }

    const now = new Date();
    const status = issues.length > 0 ? "needs_attention" : "confirmed";
    const [created] = await tx.insert(matchDemoImports).values({
      seasonId: target.match.seasonId,
      matchId: target.match.id,
      matchMapId: target.map.id,
      stageKey: target.match.stage,
      stageRunId: target.match.majorStageRunId,
      demoSha256: evidence.source.demoSha256,
      payloadSha256,
      contractVersion: evidence.contract.contractVersion,
      semanticProfile: evidence.contract.semanticProfile,
      analysisVersion: evidence.contract.analysisVersion,
      evidenceRevision: evidence.target.evidenceRevision,
      status,
      payload: evidence,
      submittedByPairingId: args.pairingId,
      idempotencyKey: args.idempotencyKey ?? null,
      supersedesImportId: null,
      issues,
      confirmedAt: status === "confirmed" ? now : null,
    }).returning();
    if (!created) throw new AppError(ErrorCode.INTERNAL_ERROR, "保存 Demo Evidence 失败。");

    if (status === "confirmed") {
      await promoteDemoImportInTx({
        tx,
        row: created,
        evidence,
        target,
        resolutions: validation.resolutions,
        actorId: `dak:${args.pairingId}`,
        verifiedBy: `dak:${args.pairingId}`,
        auditAction: "match.demo.auto_confirm",
        retryPromotion: false,
      });
    } else {
      await writeAuditInTx(tx, {
        seasonId: target.match.seasonId,
        action: "match.demo.needs_attention",
        actorId: `dak:${args.pairingId}`,
        targetId: created.id,
        meta: { mapOrder: target.map.mapOrder, playerCount: evidence.participants.length, issueCount: issues.length },
      });
    }
    return {
      status: status === "confirmed" ? "synced" : "needs_attention",
      importId: created.id,
      matchMapId: created.matchMapId,
      demoSha256: created.demoSha256,
      issues,
    };
  });
}
