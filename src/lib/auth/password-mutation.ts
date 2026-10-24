import "server-only";
import { traceOperation } from "@/lib/observability/server";
import { db } from "@/db/client";
import { beginPasswordMutationInTx, finishPasswordMutationInTx } from "./session-registry";
import { writeAuditInTx } from "@/lib/audit/write";
import { PasswordMutationError, passwordFailureCause, passwordFailureStatus } from "./password-error";

/** Provider and DB cannot commit atomically: persist a deny fence before the remote call. */
export async function mutatePassword(
  userId: string,
  startedAt: string,
  action: "user.change_password" | "user.reset_password",
  update: () => Promise<{ error: unknown }>,
): Promise<void> {
  const mutationId = await traceOperation("password.begin", { scope: "action", operation: "password.begin", stage: "transaction" }, () => db.transaction(async (tx) => {
    const id = await beginPasswordMutationInTx(tx, userId, startedAt);
    await writeAuditInTx(tx, { action: "user.password_update_started", actorId: userId, targetId: userId, meta: { operation: action, mutationId: id } });
    return id;
  }));
  // Thrown/unknown provider outcomes deliberately retain the block for operator reconciliation.
  let result: { error: unknown };
  let providerThrew = false;
  let providerCause: unknown;
  try {
    result = await traceOperation("password.provider_update", { scope: "provider", operation: "password.update", stage: "provider", provider: "supabase-auth" }, async () => {
      try { return await update(); }
      catch (cause) {
        providerThrew = true;
        providerCause = cause;
        // Credential responses may echo arbitrary passwords without a field key.
        // The generic tracer must only see this name/code allowlist, never the
        // original message, stack, body or cause. Keep the real cause solely for
        // the existing PasswordMutationError business/reconciliation boundary.
        throw passwordFailureCause(cause);
      }
    });
  } catch (cause) {
    throw new PasswordMutationError("unknown", providerThrew ? providerCause : cause);
  }
  if (result.error) {
    const status = passwordFailureStatus(result.error);
    if (status === undefined || status < 400 || status >= 500 || status === 408) {
      throw new PasswordMutationError("unknown", result.error);
    }
  }
  try {
    await traceOperation("password.finalize", { scope: "action", operation: "password.finalize", stage: "transaction" }, () => db.transaction(async (tx) => {
      await finishPasswordMutationInTx(tx, userId, mutationId);
      await writeAuditInTx(tx, {
        seasonId: null, action: result.error ? "user.password_update_failed" : action,
        actorId: userId, targetId: userId, meta: { mutationId },
      });
    }));
  } catch (cause) {
    // A rollback keeps the fence; a lost COMMIT acknowledgement is ambiguous.
    // Never retry Auth, clear the fence, or report the known provider result as unknown.
    throw new PasswordMutationError("finalization_unknown", cause, result.error ? "rejected" : "succeeded");
  }
  if (result.error) throw new PasswordMutationError("rejected", result.error);
}
