"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { applicationSessionControls } from "@/db/schema";
import { actionError, failValidation } from "@/lib/action-utils";
import { requireSuperAdmin } from "@/lib/auth/session";
import { revokeAllApplicationSessionsInTx, finishPasswordMutationInTx } from "@/lib/auth/session-registry";
import { writeAuditInTx } from "@/lib/audit/write";
import { ok, type ActionResult } from "@/types/action";

const reconciliationSchema = z.object({
  mutationId: z.uuid(),
  outcome: z.enum(["succeeded", "rejected"]),
  evidenceSource: z.enum(["supabase_auth_audit", "provider_response_log"]),
  evidenceReference: z.string().trim().min(3).max(120).regex(/^[a-zA-Z0-9_.:-]+$/),
  verified: z.literal(true),
}).strict();

export async function getPasswordReconciliationState(userId: string): Promise<ActionResult<{ mutationId: string | null }>> {
  if (!z.uuid().safeParse(userId).success) return failValidation("账号参数无效。");
  try {
    await requireSuperAdmin();
    const [control] = await db.select({ mutationId: applicationSessionControls.passwordMutationId })
      .from(applicationSessionControls).where(eq(applicationSessionControls.userId, userId));
    return ok({ mutationId: control?.mutationId ?? null });
  } catch (error) {
    return actionError("getPasswordReconciliationState", error);
  }
}

/** Break-glass owner for external Auth changes; no device-management UI. */
export async function revokeUserSessions(input: unknown): Promise<ActionResult<void>> {
  const parsed = z.object({ userId: z.uuid(), reconciliation: reconciliationSchema.optional(), providerMutationSettled: z.literal(false).optional() }).strict().safeParse(input);
  if (!parsed.success) return failValidation("账号参数无效。");
  try {
    const actor = await requireSuperAdmin();
    await db.transaction(async (tx) => {
      const reconciliation = parsed.data.reconciliation;
      if (reconciliation) {
        // The existing owner locks the user and rejects an obsolete snapshot.
        // The operator has verified the provider outcome; this never retries Auth.
        await finishPasswordMutationInTx(tx, parsed.data.userId, reconciliation.mutationId);
      } else {
        await revokeAllApplicationSessionsInTx(tx, parsed.data.userId);
      }
      await writeAuditInTx(tx, {
        action: "user.sessions_revoke", actorId: actor.userId, targetId: parsed.data.userId,
        meta: { reconciliation: parsed.data.reconciliation ?? null },
      });
    });
    return ok(undefined);
  } catch (error) {
    return actionError("revokeUserSessions", error);
  }
}
