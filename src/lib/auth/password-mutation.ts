import "server-only";
import { db } from "@/db/client";
import { beginPasswordMutationInTx, finishPasswordMutationInTx } from "./session-registry";
import { writeAuditInTx } from "@/lib/audit/write";
import { PasswordMutationError, passwordFailureStatus } from "./password-error";

/** Provider and DB cannot commit atomically: persist a deny fence before the remote call. */
export async function mutatePassword(
  userId: string,
  startedAt: string,
  action: "user.change_password" | "user.reset_password",
  update: () => Promise<{ error: unknown }>,
): Promise<void> {
  const mutationId = await db.transaction(async (tx) => {
    const id = await beginPasswordMutationInTx(tx, userId, startedAt);
    await writeAuditInTx(tx, { action: "user.password_update_started", actorId: userId, targetId: userId, meta: { operation: action } });
    return id;
  });
  // Thrown/unknown provider outcomes deliberately retain the block for operator reconciliation.
  let result: { error: unknown };
  try {
    result = await update();
  } catch (cause) {
    throw new PasswordMutationError("unknown", cause);
  }
  if (result.error) {
    const status = passwordFailureStatus(result.error);
    if (status === undefined || status < 400 || status >= 500 || status === 408) {
      throw new PasswordMutationError("unknown", result.error);
    }
  }
  await db.transaction(async (tx) => {
    await finishPasswordMutationInTx(tx, userId, mutationId);
    await writeAuditInTx(tx, {
      seasonId: null, action: result.error ? "user.password_update_failed" : action,
      actorId: userId, targetId: userId,
    });
  });
  if (result.error) throw new PasswordMutationError("rejected", result.error);
}
