"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { actionError } from "@/lib/action-utils";
import { createUserSession, requireAuth } from "@/lib/auth/session";
import { ErrorCode } from "@/lib/errors";
import { executeUserMergeInTx } from "@/lib/identity/merge";
import { loadSelfServiceMergeAuthorization, selectSelfServiceMergePair } from "@/lib/identity/self-service";
import { fail, ok, type ActionResult } from "@/types/action";

const selfServiceMergeSchema = z.object({
  authorizationId: z.uuid(),
  canonicalUserId: z.uuid(),
  expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  confirmed: z.literal(true),
});

export async function executeSelfServiceUserMerge(input: unknown): Promise<ActionResult<{ redirectTo: string }>> {
  const parsed = selfServiceMergeSchema.safeParse(input);
  if (!parsed.success) {
    return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请明确确认归并方案后再执行。" });
  }
  try {
    const session = await requireAuth();
    const authorization = await loadSelfServiceMergeAuthorization(db, {
      authorizationId: parsed.data.authorizationId,
      actorUserId: session.userId,
    });
    const pair = selectSelfServiceMergePair(authorization, parsed.data.canonicalUserId);
    await db.transaction((tx) => executeUserMergeInTx(tx, {
      ...pair,
      actorUserId: session.userId,
      expectedFingerprint: parsed.data.expectedFingerprint,
      evidenceClass: "dual_identity_control",
      reason: "用户证明控制双方 verified identity 后自助归并",
      authorizationId: authorization.id,
    }));
    const canonicalAccount = authorization.accounts.find((account) => account.id === pair.canonicalUserId);
    if (!canonicalAccount) throw new Error("归并完成后缺少 canonical account");
    await createUserSession({ userId: pair.canonicalUserId, email: canonicalAccount.email });
    revalidatePath("/settings/security");
    revalidatePath("/settings/education");
    revalidatePath(`/players/${pair.canonicalUserId}`);
    return ok({ redirectTo: "/settings/security?merged=1" });
  } catch (error) {
    return actionError("executeSelfServiceUserMerge", error);
  }
}
