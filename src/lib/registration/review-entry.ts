import type { TxDb } from "@/db/client";
import { writeAuditInTx } from "@/lib/audit/write";
import { applyEntryReviewDecisionInTx } from "@/lib/competition-entries/commands";
import { reconcileMajorPrestartRosterAfterApprovalInTx } from "@/lib/major/prestart-roster";
import { reconcileQualificationEntryAfterApprovalInTx } from "@/lib/competition-qualification/runtime";

/** The caller supplies the transaction; review and downstream roster updates commit together. */
export async function reviewCompetitionEntryWorkflowInTx(tx: TxDb, input: { entryId: string; decision: "changes_requested" | "waitlisted" | "approved" | "rejected"; reason?: string; actorId: string }) {
  const result = await applyEntryReviewDecisionInTx(tx, input);
  if (input.decision === "approved") {
    // Both consumers run in this transaction and may only use these just-assessed facts here.
    const approval = { seasonId: result.seasonId, entryId: input.entryId, actorId: input.actorId, ...(result.assessment ? { assessment: result.assessment } : {}) };
    await reconcileMajorPrestartRosterAfterApprovalInTx(tx, approval);
    await reconcileQualificationEntryAfterApprovalInTx(tx, approval);
  }
  await writeAuditInTx(tx, { seasonId: result.seasonId, action: `competition_entry.${input.decision}`, actorId: input.actorId, targetId: input.entryId, meta: { from: result.from, to: input.decision, rosterRevision: result.rosterRevision, reason: input.reason || null } });
  return { seasonSlug: result.seasonSlug };
}
