"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { applicationSessionControls } from "@/db/schema";
import { actionError, failValidation } from "@/lib/action-utils";
import { requireSuperAdmin } from "@/lib/auth/session";
import { revokeAllApplicationSessionsInTx } from "@/lib/auth/session-registry";
import { writeAuditInTx } from "@/lib/audit/write";
import { ok, type ActionResult } from "@/types/action";

/** Break-glass owner for external Auth changes; no device-management UI. */
export async function revokeUserSessions(input: unknown): Promise<ActionResult<void>> {
  const parsed = z.object({ userId: z.uuid(), providerMutationSettled: z.boolean().default(false) }).safeParse(input);
  if (!parsed.success) return failValidation("账号参数无效。");
  try {
    const actor = await requireSuperAdmin();
    await db.transaction(async (tx) => {
      await revokeAllApplicationSessionsInTx(tx, parsed.data.userId);
      // Explicit operator assertion: provider mutation has finished and outcome was reconciled.
      if (parsed.data.providerMutationSettled) {
        await tx.update(applicationSessionControls).set({ passwordMutationId: null })
          .where(eq(applicationSessionControls.userId, parsed.data.userId));
      }
      await writeAuditInTx(tx, {
        action: "user.sessions_revoke", actorId: actor.userId, targetId: parsed.data.userId,
        meta: { providerMutationSettled: parsed.data.providerMutationSettled },
      });
    });
    return ok(undefined);
  } catch (error) {
    return actionError("revokeUserSessions", error);
  }
}
